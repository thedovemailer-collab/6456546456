' ── Do NOT import Telegram.Bot.Types or TL at the top level ─────────────────
' WTelegramClient pollutes the global namespace with TL.User, TL.Message etc.
' We use full qualified names for all Telegram types instead.
Imports System
Imports System.Collections
Imports System.Collections.Concurrent
Imports System.IO
Imports System.Net.Http
Imports System.Threading
Imports System.Threading.Tasks
Imports System.Windows.Forms
Imports Microsoft.Web.WebView2.WinForms
Imports Microsoft.Web.WebView2.Core
Imports Newtonsoft.Json
Imports Newtonsoft.Json.Linq
Imports Telegram.Bot
Imports Telegram.Bot.Polling
Imports Discord
Imports Discord.WebSocket
' WTelegramClient — User API (MTProto). Keep all TL references fully qualified
' (TL.User, TL.Message, …) so they don't clash with Telegram.Bot.Types.User.
Imports WTelegram
Imports TL
' Short, unambiguous names for the window-frame code. Discord and TL both
' define types called Color / Message, so these are always spelled out.
Imports SD = System.Drawing
Imports SD2 = System.Drawing.Drawing2D
Imports SWF = System.Windows.Forms

Public Class Form1
    Inherits Form

    ' NOTE: webView2 is declared in Form1.Designer.vb — do not redeclare here
    Private tgBotClient As TelegramBotClient
    Private tgCts As CancellationTokenSource
    Private tgConnected As Boolean = False
    Private tgToken As String = ""
    Private tgBotId As Long = 0
    Private tgBotUsername As String = ""

    ' ── Bot API live auto-reconnect state ────────────────────────────
    ' When the internet drops, Telegram.Bot's long-poll ReceiveAsync throws.
    ' Instead of giving up (which left the bot dead until the operator
    ' re-connected by hand), the polling task now supervises itself: it
    ' backs off and keeps re-probing the Bot API until the connection comes
    ' back live. _tgBotIntentionalDisconnect suppresses that loop when the
    ' operator (or a fresh connect) deliberately tears the session down.
    Private _tgBotIntentionalDisconnect As Boolean = False

    ' ── User API (MTProto via WTelegramClient) ──────────────────────────
    Private tgUserClient As WTelegram.Client
    Private tgUserCts As CancellationTokenSource           ' cancels heartbeat + update pump
    Private tgUserConnected As Boolean = False
    Private tgUserSelfId As Long = 0
    Private tgUserSelfUsername As String = ""
    Private tgUserApiId As String = ""
    Private tgUserApiHash As String = ""
    Private tgUserPhone As String = ""
    Private tgUserSessionPath As String = ""
    Private ReadOnly tgUserAuthAnswers As New ConcurrentDictionary(Of String, TaskCompletionSource(Of String))(StringComparer.OrdinalIgnoreCase)
    Private tgUserUpdateMgr As WTelegram.UpdateManager

    ' ── Persistent peer cache — survives reconnects within the process
    ' and is serialised to disk so cold outbound works after restart.
    ' Keys are Long user/chat IDs; values are TL.InputPeer references.
    ' Written by the 4-stage resolver; read by every send/action method.
    Private ReadOnly _peerCache As New ConcurrentDictionary(Of Long, TL.InputPeer)()
    Private _peerCachePath As String = ""                  ' set after session path is known
    Private ReadOnly _peerCacheLock As New SemaphoreSlim(1, 1)

    ' ── Reconnect state for User API ──────────────────────────────────
    ' Tracks whether a reconnect loop is already running so we never spin
    ' up two overlapping supervision tasks.
    Private _tgUserReconnecting As Boolean = False
    Private ReadOnly _tgUserReconnectLock As New Object()

    ' ── Outage recovery ─────────────────────────────────────────────
    ' Inbound User API messages already posted to the page. A catch-up
    ' after an outage re-reads recent history, and anything seen live
    ' must not be posted (and answered) twice.
    Private ReadOnly _seenTgUserInbound As New ConcurrentDictionary(Of String, Byte)()
    ' Last moment the User API connection was known good (UTC). A catch-up
    ' fetches everything newer than this.
    Private _tgUserLastOkUtc As DateTime = DateTime.MinValue
    Private _tgUserDisplayName As String = ""
    Private _tgUserHandle As String = ""
    Private _tgCatchUpRunning As Integer = 0
    ' The Bot API backlog is dropped only on the first connect of the
    ' process. Reconnects keep it — that backlog IS the missed messages.
    Private _tgBotEverConnected As Boolean = False

    ' ── Discord ──────────────────────────────────────────────────────
    Private dcClient As DiscordSocketClient
    Private dcConnected As Boolean = False
    Private dcSelfId As ULong = 0
    Private dcToken As String = ""
    ' Last-resort watchdog for Discord. Fires once if Discord.NET's own
    ' reconnect gives up (rare auth-reject case). Thread-safe via Interlocked.
    Private _dcWatchdogFired As Integer = 0                ' 0=armed, 1=fired
    Private _dcWatchdogCts As CancellationTokenSource
    ' Per-user DM channel cache — avoids re-creating DM channels on every cold send.
    Private ReadOnly _dcDmCache As New ConcurrentDictionary(Of ULong, IDMChannel)()

    ' ── Profile cache ────────────────────────────────────────────────────
    Private Class CachedProfile
        Public Avatar As String
        Public Bio As String
        Public CoverUrl As String
        Public MediaUrl As String
        Public FetchedAt As DateTime
    End Class
    Private Shared ReadOnly ProfileCache As New ConcurrentDictionary(Of String, CachedProfile)()
    Private Shared ReadOnly ProfileCacheTtl As TimeSpan = TimeSpan.FromMinutes(10)

    Private Shared Function ProfileCacheGet(key As String) As CachedProfile
        Dim cp As CachedProfile = Nothing
        If ProfileCache.TryGetValue(key, cp) Then
            If (DateTime.UtcNow - cp.FetchedAt) < ProfileCacheTtl Then Return cp
            ProfileCache.TryRemove(key, cp)
        End If
        Return Nothing
    End Function
    Private Shared Sub ProfileCacheSet(key As String, avatar As String, bio As String, coverUrl As String)
        ProfileCache(key) = New CachedProfile With {
            .Avatar = avatar, .Bio = bio, .CoverUrl = coverUrl,
            .FetchedAt = DateTime.UtcNow
        }
    End Sub

    ' ── DevTools console log-level filter ───────────────────────────────
    Private Const DEBUG_VERBOSE As Boolean = False

    ' Reusable HTTP client for downloading file paths from CDNs.
    Private Shared ReadOnly Http As HttpClient = BuildHttpClient()
    Private Shared Function BuildHttpClient() As HttpClient
        Dim h As New HttpClient()
        h.Timeout = TimeSpan.FromSeconds(20)
        Return h
    End Function

    ' Attachment downloads and raw Bot API calls. A 40 MB document over a
    ' slow link does not fit in the 20-second budget the small client has.
    Private Shared ReadOnly HttpBig As HttpClient = BuildBigHttpClient()
    Private Shared Function BuildBigHttpClient() As HttpClient
        Dim h As New HttpClient()
        h.Timeout = TimeSpan.FromMinutes(5)
        Return h
    End Function

    ' ── App + media hosting ─────────────────────────────────────────
    Private Const APP_URL As String = "https://lefty.pro/MyResponder/copy/BotCommand.html"
    ' Inbound attachments too big to travel as a data: URL are written to a
    ' local cache folder and served to the page from this virtual host
    ' (SetVirtualHostNameToFolderMapping). The URL is short, so it is stored
    ' in the message row and still works after a reload. ".example" is a
    ' reserved TLD, so it can never collide with a real site.
    Private Const MEDIA_HOST As String = "bc-media.example"
    Private _mediaDir As String = ""
    ' Largest attachment we download from any platform.
    Private Const MEDIA_MAX_BYTES As Long = 50L * 1024L * 1024L
    ' Attachments up to this size are downloaded BEFORE the message is shown,
    ' so it arrives complete. Bigger ones are shown at once with a
    ' "downloading" chip and filled in by a mediaReady event.
    Private Const MEDIA_INLINE_AWAIT_MAX As Long = 6L * 1024L * 1024L
    ' Up to this size an attachment travels as a data: URL — self-contained
    ' and small enough for the database. Larger ones go to the local cache.
    Private Const MEDIA_DATAURL_MAX As Long = 2500L * 1024L
    ' Never launched directly when the operator clicks "Open" — shown in
    ' Explorer instead. A customer-sent .exe must not run on one click.
    Private Shared ReadOnly RiskyExt As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase) From {
        ".exe", ".msi", ".msp", ".bat", ".cmd", ".com", ".scr", ".ps1", ".psm1", ".vbs", ".vbe",
        ".js", ".jse", ".wsf", ".wsh", ".hta", ".jar", ".lnk", ".url", ".reg", ".cpl", ".msc",
        ".pif", ".dll", ".sys", ".appx", ".appxbundle", ".msix", ".iso", ".img", ".vhd", ".vhdx",
        ".application", ".gadget", ".inf", ".scf", ".chm"}

#Region "Form Init"

    Private Async Sub Form1_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        Await WebView1.EnsureCoreWebView2Async(Nothing)
        AddHandler WebView1.CoreWebView2.WebMessageReceived, AddressOf OnWebMessage
        AddHandler WebView1.CoreWebView2.NavigationCompleted, AddressOf OnNavigationCompleted
        ' A click on a file/link must never navigate the app itself away —
        ' that replaced the whole UI with a PDF viewer or a blank page.
        AddHandler WebView1.CoreWebView2.NavigationStarting, AddressOf OnNavigationStarting
        AddHandler WebView1.CoreWebView2.NewWindowRequested, AddressOf OnNewWindowRequested
        SetupMediaCache()

        ' The app page itself must never come from a stale cache — the
        ' window's resize behaviour depends on host and page matching. Every
        ' load revalidates it with the server (a 304 when nothing changed, so
        ' it costs nothing when it's current).
        Try
            WebView1.CoreWebView2.AddWebResourceRequestedFilter(APP_URL & "*", CoreWebView2WebResourceContext.Document)
            AddHandler WebView1.CoreWebView2.WebResourceRequested, AddressOf OnAppDocumentRequested
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[BotCommand] Failed to add document revalidation: " & ex.Message)
        End Try

        ' Live-resize helper for the page (see "Window frame" → SetPageSizing).
        ' Registered before the first navigation so every document gets it.
        Try
            Await WebView1.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(PAGE_SIZING_SCRIPT)
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[BotCommand] Failed to add sizing script: " & ex.Message)
        End Try

        Try
            Await WebView1.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}")
            Dim consoleListener = WebView1.CoreWebView2.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled")
            AddHandler consoleListener.DevToolsProtocolEventReceived, AddressOf OnDevToolsConsole
            Dim exceptionListener = WebView1.CoreWebView2.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown")
            AddHandler exceptionListener.DevToolsProtocolEventReceived, AddressOf OnDevToolsException
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[BotCommand] Failed to attach DevTools console listener: " & ex.Message)
        End Try

        WebView1.Source = New Uri(APP_URL)
    End Sub

    Private Sub OnDevToolsConsole(sender As Object, e As CoreWebView2DevToolsProtocolEventReceivedEventArgs)
        Try
            Dim json As JObject = JObject.Parse(e.ParameterObjectAsJson)
            Dim level As String = If(json("type") IsNot Nothing, json("type").ToString(), "log")
            Dim parts As New System.Text.StringBuilder()
            Dim args = TryCast(json("args"), JArray)
            If args IsNot Nothing Then
                For Each a In args
                    Dim valTok = a("value")
                    Dim descTok = a("description")
                    Dim s As String
                    If valTok IsNot Nothing Then
                        s = valTok.ToString()
                    ElseIf descTok IsNot Nothing Then
                        s = descTok.ToString()
                    Else
                        s = a.ToString(Newtonsoft.Json.Formatting.None)
                    End If
                    If parts.Length > 0 Then parts.Append(" ")
                    parts.Append(s)
                Next
            End If
            ' Filter noisy low-priority console output UNLESS it is an
            ' invoice/payment/delivery diagnostic — those must always be
            ' visible so post-payment delivery issues can be traced in the
            ' running app even with DEBUG_VERBOSE off.
            If Not DEBUG_VERBOSE Then
                Select Case level
                    Case "log", "debug", "trace"
                        Dim body As String = parts.ToString()
                        Dim keep As Boolean = body.IndexOf("[invoice]", StringComparison.OrdinalIgnoreCase) >= 0 _
                            OrElse body.IndexOf("[delivery]", StringComparison.OrdinalIgnoreCase) >= 0 _
                            OrElse body.IndexOf("[payment]", StringComparison.OrdinalIgnoreCase) >= 0 _
                            OrElse body.IndexOf("[pay]", StringComparison.OrdinalIgnoreCase) >= 0
                        If Not keep Then Return
                End Select
            End If
            System.Diagnostics.Debug.WriteLine("[js " & level & "] " & parts.ToString())
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[js console parse error] " & ex.Message)
        End Try
    End Sub

    Private Sub OnDevToolsException(sender As Object, e As CoreWebView2DevToolsProtocolEventReceivedEventArgs)
        Try
            Dim json As JObject = JObject.Parse(e.ParameterObjectAsJson)
            Dim det = json("exceptionDetails")
            If det Is Nothing Then Return
            Dim msg As String = If(det("text") IsNot Nothing, det("text").ToString(), "Exception")
            Dim ex2 = det("exception")
            If ex2 IsNot Nothing AndAlso ex2("description") IsNot Nothing Then
                msg = msg & " — " & ex2("description").ToString()
            End If
            System.Diagnostics.Debug.WriteLine("[js EXCEPTION] " & msg)
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[js exception parse error] " & ex.Message)
        End Try
    End Sub

    Private Async Sub OnNavigationCompleted(sender As Object, e As CoreWebView2NavigationCompletedEventArgs)
        Await Task.Delay(500)
        PostToJS("dotNetReady", New With {.msg = "Form1 connected · WebView2 bridge active"})
    End Sub

#End Region

#Region "Media cache, open and save"

    Private Sub SetupMediaCache()
        Try
            _mediaDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BotCommand", "media")
            Directory.CreateDirectory(_mediaDir)
            WebView1.CoreWebView2.SetVirtualHostNameToFolderMapping(
                MEDIA_HOST, _mediaDir, CoreWebView2HostResourceAccessKind.Allow)
        Catch ex As Exception
            _mediaDir = ""
            System.Diagnostics.Debug.WriteLine("[media] cache unavailable: " & ex.Message)
        End Try
    End Sub

    Private Function SafeFileName(name As String, fallback As String) As String
        Dim n As String = If(name, "").Trim()
        For Each c As Char In Path.GetInvalidFileNameChars()
            n = n.Replace(c, "_"c)
        Next
        n = n.Trim("."c, " "c)
        If n.Length > 120 Then
            Dim ext As String = Path.GetExtension(n)
            If ext.Length > 12 Then ext = ""
            n = n.Substring(0, 120 - ext.Length) & ext
        End If
        If String.IsNullOrEmpty(n) Then n = fallback
        Return n
    End Function

    ' ".pdf" for "application/pdf" etc. Reuses DecodeDataUrl's table.
    Private Function ExtForMime(mime As String) As String
        Try
            Dim ext As String = DecodeDataUrl("data:" & If(mime, "") & ";base64,").Ext
            If String.IsNullOrEmpty(ext) Then ext = "bin"
            Return "." & ext
        Catch
            Return ".bin"
        End Try
    End Function

    ' Bytes → a URL the page can show and the database can keep.
    Private Function StoreInboundMedia(bytes As Byte(), mime As String, fileName As String) As String
        If bytes Is Nothing OrElse bytes.Length = 0 Then Return ""
        Dim m As String = If(String.IsNullOrWhiteSpace(mime), "application/octet-stream", mime.Trim())
        If bytes.LongLength <= MEDIA_DATAURL_MAX OrElse String.IsNullOrEmpty(_mediaDir) Then
            Dim head As String = m
            If Not String.IsNullOrEmpty(fileName) Then head &= ";name=" & Uri.EscapeDataString(fileName)
            Return "data:" & head & ";base64," & Convert.ToBase64String(bytes)
        End If
        Try
            Dim folder As String = Guid.NewGuid().ToString("N")
            Dim safe As String = SafeFileName(fileName, "file" & ExtForMime(m))
            Dim dir As String = Path.Combine(_mediaDir, folder)
            Directory.CreateDirectory(dir)
            File.WriteAllBytes(Path.Combine(dir, safe), bytes)
            Return "https://" & MEDIA_HOST & "/" & folder & "/" & Uri.EscapeDataString(safe)
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[media] cache write failed: " & ex.Message)
            Return ""
        End Try
    End Function

    ' https://bc-media.example/<folder>/<name> → the file on disk, or "".
    ' Rejects anything that would resolve outside the cache folder.
    Private Function MediaUrlToLocalPath(url As String) As String
        Try
            If String.IsNullOrEmpty(_mediaDir) OrElse String.IsNullOrEmpty(url) Then Return ""
            Dim u As Uri = Nothing
            If Not Uri.TryCreate(url, UriKind.Absolute, u) Then Return ""
            If Not String.Equals(u.Host, MEDIA_HOST, StringComparison.OrdinalIgnoreCase) Then Return ""
            Dim rel As String = Uri.UnescapeDataString(u.AbsolutePath.TrimStart("/"c)).Replace("/"c, Path.DirectorySeparatorChar)
            Dim full As String = Path.GetFullPath(Path.Combine(_mediaDir, rel))
            Dim root As String = Path.GetFullPath(_mediaDir).TrimEnd(Path.DirectorySeparatorChar) & Path.DirectorySeparatorChar
            If Not full.StartsWith(root, StringComparison.OrdinalIgnoreCase) Then Return ""
            If Not File.Exists(full) Then Return ""
            Return full
        Catch
            Return ""
        End Try
    End Function

    ' Outbound sends understand data: URLs and public http(s) URLs. A cached
    ' local file is turned back into a data: URL so every send path works.
    Private Function LocalMediaToDataUrl(url As String) As String
        Dim local As String = MediaUrlToLocalPath(url)
        If local = "" Then Return url
        Try
            Dim name As String = Path.GetFileName(local)
            Return "data:application/octet-stream;name=" & Uri.EscapeDataString(name) & ";base64," &
                   Convert.ToBase64String(File.ReadAllBytes(local))
        Catch
            Return url
        End Try
    End Function

    Private Function NameFromDataUrl(url As String) As String
        Try
            Dim comma As Integer = url.IndexOf(","c)
            If comma < 0 Then Return ""
            For Each part As String In url.Substring(5, comma - 5).Split(";"c)
                If part.StartsWith("name=", StringComparison.OrdinalIgnoreCase) Then
                    Return Uri.UnescapeDataString(part.Substring(5))
                End If
            Next
        Catch
        End Try
        Return ""
    End Function

    ' Any attachment URL the page holds → bytes + a sensible file name.
    Private Async Function ResolveMediaBytesAsync(url As String, nameHint As String) As Task(Of (Bytes As Byte(), Name As String))
        Dim name As String = If(nameHint, "").Trim()
        If url.StartsWith("data:", StringComparison.OrdinalIgnoreCase) Then
            Dim d = DecodeDataUrl(url)
            If name = "" Then name = NameFromDataUrl(url)
            If name = "" Then name = "file." & If(String.IsNullOrEmpty(d.Ext), "bin", d.Ext)
            Return (d.Bytes, name)
        End If
        Dim local As String = MediaUrlToLocalPath(url)
        If local <> "" Then
            If name = "" Then name = Path.GetFileName(local)
            Return (File.ReadAllBytes(local), name)
        End If
        Dim resp = Await HttpBig.GetAsync(url)
        resp.EnsureSuccessStatusCode()
        Dim bytes As Byte() = Await resp.Content.ReadAsByteArrayAsync()
        If name = "" Then
            Try
                Dim u As New Uri(url)
                name = Uri.UnescapeDataString(Path.GetFileName(u.AbsolutePath))
            Catch
            End Try
        End If
        If name = "" Then name = "file.bin"
        Return (bytes, name)
    End Function

    ' Open with the default app. Executables and scripts are revealed in
    ' Explorer instead of launched.
    Private Async Sub OpenMedia(url As String, nameHint As String)
        Try
            If String.IsNullOrEmpty(url) Then Return
            Dim target As String = MediaUrlToLocalPath(url)
            Dim isWeb As Boolean = url.StartsWith("http", StringComparison.OrdinalIgnoreCase) AndAlso target = ""
            If isWeb AndAlso String.IsNullOrEmpty(nameHint) Then
                ' A plain web link — the browser is the right place for it.
                System.Diagnostics.Process.Start(New System.Diagnostics.ProcessStartInfo(url) With {.UseShellExecute = True})
                PostToJS("mediaOpened", New With {.ok = True, .url = url})
                Return
            End If
            If target = "" Then
                Dim got = Await ResolveMediaBytesAsync(url, nameHint)
                If got.Bytes Is Nothing OrElse got.Bytes.Length = 0 Then Throw New Exception("File is empty or unavailable.")
                Dim baseDir As String = If(String.IsNullOrEmpty(_mediaDir), Path.GetTempPath(), _mediaDir)
                Dim dir As String = Path.Combine(baseDir, "open", Guid.NewGuid().ToString("N"))
                Directory.CreateDirectory(dir)
                target = Path.Combine(dir, SafeFileName(got.Name, "file.bin"))
                File.WriteAllBytes(target, got.Bytes)
            End If
            Dim risky As Boolean = RiskyExt.Contains(Path.GetExtension(target))
            If risky Then
                System.Diagnostics.Process.Start("explorer.exe", "/select," & ChrW(34) & target & ChrW(34))
            Else
                System.Diagnostics.Process.Start(New System.Diagnostics.ProcessStartInfo(target) With {.UseShellExecute = True})
            End If
            PostToJS("mediaOpened", New With {.ok = True, .revealed = risky, .name = Path.GetFileName(target)})
        Catch ex As Exception
            PostToJS("mediaOpened", New With {.ok = False, .error = ex.Message})
        End Try
    End Sub

    ' Save As… Runs on the UI thread (called from OnWebMessage), so the
    ' dialog is owned by the main window.
    Private Async Sub SaveMediaAs(url As String, nameHint As String)
        Try
            If String.IsNullOrEmpty(url) Then Return
            Dim got = Await ResolveMediaBytesAsync(url, nameHint)
            If got.Bytes Is Nothing OrElse got.Bytes.Length = 0 Then Throw New Exception("File is empty or unavailable.")
            Using dlg As New SaveFileDialog()
                dlg.FileName = SafeFileName(got.Name, "file.bin")
                Dim ext As String = Path.GetExtension(dlg.FileName)
                dlg.Filter = If(ext <> "", ext.TrimStart("."c).ToUpperInvariant() & " file|*" & ext & "|All files|*.*", "All files|*.*")
                dlg.OverwritePrompt = True
                dlg.RestoreDirectory = True
                If dlg.ShowDialog(Me) <> DialogResult.OK Then
                    PostToJS("mediaSaved", New With {.ok = False, .cancelled = True})
                    Return
                End If
                File.WriteAllBytes(dlg.FileName, got.Bytes)
                PostToJS("mediaSaved", New With {.ok = True, .path = dlg.FileName, .name = Path.GetFileName(dlg.FileName)})
            End Using
        Catch ex As Exception
            PostToJS("mediaSaved", New With {.ok = False, .error = ex.Message})
        End Try
    End Sub

    ' Revalidate the app page on every load (see Form1_Load).
    Private Sub OnAppDocumentRequested(sender As Object, e As CoreWebView2WebResourceRequestedEventArgs)
        Try
            e.Request.Headers.SetHeader("Cache-Control", "no-cache")
            e.Request.Headers.SetHeader("Pragma", "no-cache")
        Catch
        End Try
    End Sub

    Private Sub OnNavigationStarting(sender As Object, e As CoreWebView2NavigationStartingEventArgs)
        Try
            Dim u As Uri = Nothing
            If Not Uri.TryCreate(e.Uri, UriKind.Absolute, u) Then Return
            If u.Scheme <> Uri.UriSchemeHttp AndAlso u.Scheme <> Uri.UriSchemeHttps Then Return
            If String.Equals(u.Host, New Uri(APP_URL).Host, StringComparison.OrdinalIgnoreCase) Then Return
            Dim isMedia As Boolean = String.Equals(u.Host, MEDIA_HOST, StringComparison.OrdinalIgnoreCase)
            ' Only user clicks (and our own media host) are redirected; the
            ' page's own redirects are left alone.
            If Not isMedia AndAlso Not e.IsUserInitiated Then Return
            e.Cancel = True
            OpenMedia(u.ToString(), If(isMedia, Uri.UnescapeDataString(Path.GetFileName(u.AbsolutePath)), ""))
        Catch
        End Try
    End Sub

    Private Sub OnNewWindowRequested(sender As Object, e As CoreWebView2NewWindowRequestedEventArgs)
        Try
            Dim u As Uri = Nothing
            If Not Uri.TryCreate(e.Uri, UriKind.Absolute, u) Then Return
            ' The license test page opens in its own centred, app-styled
            ' window instead of WebView2's default popup (which appeared at
            ' an arbitrary size and spot, with the API key in an address bar).
            If IsLicenseCheckUrl(u) Then
                e.Handled = True
                OpenLicenseCheckWindow(u.ToString())
                Return
            End If
            If Not String.Equals(u.Host, MEDIA_HOST, StringComparison.OrdinalIgnoreCase) Then Return
            e.Handled = True
            OpenMedia(u.ToString(), Uri.UnescapeDataString(Path.GetFileName(u.AbsolutePath)))
        Catch
        End Try
    End Sub

    ' ── License check window ──────────────────────────────────────────
    ' One window, reused: a second click brings it forward and reloads it.
    ' Sized for the page (a 520px column plus its margins), centred on the
    ' working area of the monitor the app is on, clamped to fit smaller
    ' screens, and scaled for the display's DPI. It shares the app's
    ' WebView2 environment, so it sees the same saved theme and accent.
    Private _licWin As Form = Nothing
    Private _licView As Microsoft.Web.WebView2.WinForms.WebView2 = Nothing
    Private Const LIC_WIN_W As Integer = 600
    Private Const LIC_WIN_H As Integer = 780

    <System.Runtime.InteropServices.DllImport("dwmapi.dll")>
    Private Shared Function DwmSetWindowAttribute(hwnd As IntPtr, attr As Integer, ByRef attrValue As Integer, attrSize As Integer) As Integer
    End Function

    Private Shared Function IsLicenseCheckUrl(u As Uri) As Boolean
        If u Is Nothing Then Return False
        If u.Scheme <> Uri.UriSchemeHttp AndAlso u.Scheme <> Uri.UriSchemeHttps Then Return False
        If Not String.Equals(u.Host, New Uri(APP_URL).Host, StringComparison.OrdinalIgnoreCase) Then Return False
        Return u.Query.IndexOf("action=verify_license", StringComparison.OrdinalIgnoreCase) >= 0
    End Function

    ' Dark title bar in the page's own background colour (Windows 10 20H1+
    ' honours attribute 20, older builds 19; Windows 11 also takes the
    ' caption and border colours). Anything unsupported is simply ignored.
    Private Shared Sub StyleDarkTitleBar(win As Form, bg As System.Drawing.Color)
        Try
            Dim h As IntPtr = win.Handle
            Dim one As Integer = 1
            If DwmSetWindowAttribute(h, 20, one, 4) <> 0 Then DwmSetWindowAttribute(h, 19, one, 4)
            Dim colorRef As Integer = bg.R Or (CInt(bg.G) << 8) Or (CInt(bg.B) << 16)
            DwmSetWindowAttribute(h, 35, colorRef, 4)       ' caption colour
            Dim edge As Integer = &H241C18                  ' a soft dark border (BGR 18,1C,24)
            DwmSetWindowAttribute(h, 34, edge, 4)           ' border colour
        Catch
        End Try
    End Sub

    Private Async Sub OpenLicenseCheckWindow(url As String)
        Try
            ' Already open: bring it forward on the same page.
            If _licWin IsNot Nothing AndAlso Not _licWin.IsDisposed Then
                If _licView IsNot Nothing AndAlso _licView.CoreWebView2 IsNot Nothing Then _licView.CoreWebView2.Navigate(url)
                If _licWin.WindowState = SWF.FormWindowState.Minimized Then _licWin.WindowState = SWF.FormWindowState.Normal
                _licWin.Activate()
                Return
            End If

            Dim bg As System.Drawing.Color = System.Drawing.Color.FromArgb(6, 8, 11)
            Dim scale As Double = 1.0
            Try
                Using g As System.Drawing.Graphics = Me.CreateGraphics()
                    scale = Math.Max(1.0, g.DpiX / 96.0)
                End Using
            Catch
            End Try
            Dim area As System.Drawing.Rectangle = System.Windows.Forms.Screen.FromControl(Me).WorkingArea
            Dim w As Integer = CInt(Math.Min(LIC_WIN_W * scale, area.Width * 0.92))
            Dim h As Integer = CInt(Math.Min(LIC_WIN_H * scale, area.Height * 0.9))

            Dim win As New Form()
            win.Text = "License check"
            win.StartPosition = SWF.FormStartPosition.Manual
            win.Bounds = New System.Drawing.Rectangle(area.Left + (area.Width - w) \ 2, area.Top + (area.Height - h) \ 2, w, h)
            win.MinimumSize = New System.Drawing.Size(CInt(Math.Min(440 * scale, w)), CInt(Math.Min(480 * scale, h)))
            win.BackColor = bg
            win.ShowInTaskbar = True
            win.MaximizeBox = False
            win.KeyPreview = True
            Try
                win.Icon = Me.Icon
            Catch
            End Try

            Dim wv As New Microsoft.Web.WebView2.WinForms.WebView2()
            wv.Dock = SWF.DockStyle.Fill
            wv.DefaultBackgroundColor = bg
            win.Controls.Add(wv)

            _licWin = win
            _licView = wv
            AddHandler win.HandleCreated, Sub(s2 As Object, a2 As EventArgs)
                                              StyleDarkTitleBar(win, bg)
                                              SyncLicenseWindowFrame()
                                          End Sub
            AddHandler win.FormClosed, Sub(s2 As Object, a2 As SWF.FormClosedEventArgs)
                                           _licWin = Nothing
                                           _licView = Nothing
                                       End Sub
            ' Esc closes it, like the app's own popups.
            AddHandler win.KeyDown, Sub(s2 As Object, a2 As SWF.KeyEventArgs)
                                        If a2.KeyCode = SWF.Keys.Escape Then win.Close()
                                    End Sub

            win.Show(Me)

            Await wv.EnsureCoreWebView2Async(WebView1.CoreWebView2.Environment)
            If win.IsDisposed Then Return
            wv.CoreWebView2.Settings.IsStatusBarEnabled = False
            AddHandler wv.CoreWebView2.DocumentTitleChanged, Sub(s2 As Object, a2 As Object)
                                                                 Try
                                                                     Dim t As String = wv.CoreWebView2.DocumentTitle
                                                                     If Not String.IsNullOrWhiteSpace(t) AndAlso Not t.StartsWith("http", StringComparison.OrdinalIgnoreCase) Then win.Text = t
                                                                 Catch
                                                                 End Try
                                                             End Sub
            ' Links on the page that open a new tab (the raw JSON) go to the
            ' default browser rather than spawning another bare popup.
            AddHandler wv.CoreWebView2.NewWindowRequested, Sub(s2 As Object, a2 As CoreWebView2NewWindowRequestedEventArgs)
                                                               a2.Handled = True
                                                               Try
                                                                   System.Diagnostics.Process.Start(New System.Diagnostics.ProcessStartInfo(a2.Uri) With {.UseShellExecute = True})
                                                               Catch
                                                               End Try
                                                           End Sub
            wv.CoreWebView2.Navigate(url)
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[BotCommand] License window failed: " & ex.Message)
            ' Fall back to the default browser so the page still opens.
            Try
                System.Diagnostics.Process.Start(New System.Diagnostics.ProcessStartInfo(url) With {.UseShellExecute = True})
            Catch
            End Try
        End Try
    End Sub

    ' Reads a field or property by name (case-insensitive), so TL / SDK
    ' members that moved or were renamed between library versions don't
    ' break the build.
    Private Function ReadMember(obj As Object, memberName As String) As Object
        If obj Is Nothing OrElse String.IsNullOrEmpty(memberName) Then Return Nothing
        Try
            Dim t = obj.GetType()
            Dim flags = System.Reflection.BindingFlags.Public Or System.Reflection.BindingFlags.NonPublic Or
                        System.Reflection.BindingFlags.Instance Or System.Reflection.BindingFlags.IgnoreCase
            Dim f = t.GetField(memberName, flags)
            If f IsNot Nothing Then Return f.GetValue(obj)
            Dim p = t.GetProperty(memberName, flags)
            If p IsNot Nothing AndAlso p.CanRead AndAlso p.GetIndexParameters().Length = 0 Then Return p.GetValue(obj, Nothing)
        Catch
        End Try
        Return Nothing
    End Function

    Private Function ReadStr(obj As Object, memberName As String) As String
        Dim v = ReadMember(obj, memberName)
        Return If(v Is Nothing, "", v.ToString())
    End Function

    Private Function ReadLong(obj As Object, memberName As String) As Long
        Dim v = ReadMember(obj, memberName)
        If v Is Nothing Then Return 0
        Try
            Return Convert.ToInt64(v)
        Catch
            Return 0
        End Try
    End Function

    Private Shared Function JStr(json As JObject, key As String) As String
        Dim t As JToken = json(key)
        If t Is Nothing OrElse t.Type = JTokenType.Null Then Return ""
        Return t.ToString()
    End Function

#End Region

#Region "JS to NET Bridge"

    Private Sub OnWebMessage(sender As Object, e As CoreWebView2WebMessageReceivedEventArgs)
        Dim raw As String = e.TryGetWebMessageAsString()
        If String.IsNullOrEmpty(raw) Then Return
        Dim json As JObject
        Try
            json = JObject.Parse(raw)
        Catch
            Return
        End Try
        Dim action As String = If(json("action") IsNot Nothing, json("action").ToString(), "")
        Select Case action
            Case "windowTheme"
                ApplyWindowThemeFromJs(json)
            Case "jsReady"
                PostToJS("dotNetReady", New With {.msg = "Form1 connected · WebView2 bridge active"})
            Case "ping"
                PostToJS("pong", New With {.msg = "Form1 is alive · " & DateTime.Now.ToString("HH:mm:ss")})
            Case "connectTelegram"
                Dim token As String = If(json("token") IsNot Nothing, json("token").ToString(), "")
                Task.Run(Sub() ConnectTelegramBot(token))
            Case "connectTelegramUser"
                Dim apiId As String = If(json("apiId") IsNot Nothing, json("apiId").ToString(), "")
                Dim apiHash As String = If(json("apiHash") IsNot Nothing, json("apiHash").ToString(), "")
                Dim phone As String = If(json("phone") IsNot Nothing, json("phone").ToString(), "")
                Task.Run(Sub() ConnectTelegramUser(apiId, apiHash, phone))
            Case "submitTelegramCode"
                Dim code As String = If(json("code") IsNot Nothing, json("code").ToString(), "")
                Dim pwd As String = If(json("password") IsNot Nothing, json("password").ToString(), "")
                ProvideTelegramAuthAnswer(code, pwd)
            Case "cancelTelegramAuth"
                CancelTelegramUserAuth()
            Case "connectDiscord"
                Dim token As String = If(json("token") IsNot Nothing, json("token").ToString(), "")
                Task.Run(Function() ConnectDiscord(token))
            Case "disconnectTelegram"
                DisconnectTelegram()
            Case "disconnectDiscord"
                Task.Run(Function() DisconnectDiscord())
            Case "sendMessage"
                ' replyTo  — platform message id to quote (optional)
                ' replyVia — "user" | "bot" for Telegram: which API numbered
                '            that id. Replies go out through the same API.
                ' reqId    — echoed back on sendOk/sendError so the page can
                '            tie the platform's message id to its bubble.
                Dim platform As String = JStr(json, "platform")
                Dim chatId As String = JStr(json, "chatId")
                Dim text As String = JStr(json, "text")
                Dim sReply As String = JStr(json, "replyTo")
                Dim sVia As String = JStr(json, "replyVia")
                Dim sReq As String = JStr(json, "reqId")
                Task.Run(Sub() SendPlatformMessage(platform, chatId, text, sReply, sVia, sReq))
            Case "sendMedia"
                Dim mPlatform As String = JStr(json, "platform")
                Dim mChatId As String = JStr(json, "chatId")
                Dim mUrl As String = JStr(json, "mediaUrl")
                Dim mCap As String = JStr(json, "caption")
                Dim mKind As String = If(JStr(json, "mediaKind") = "", "photo", JStr(json, "mediaKind"))
                Dim mFileName As String = JStr(json, "fileName")
                Dim mReply As String = JStr(json, "replyTo")
                Dim mVia As String = JStr(json, "replyVia")
                Dim mReq As String = JStr(json, "reqId")
                Task.Run(Sub() SendPlatformMedia(mPlatform, mChatId, mUrl, mCap, mKind, mFileName, mReply, mVia, mReq))
            Case "editMessage"
                Dim ePlatform As String = JStr(json, "platform")
                Dim eChatId As String = JStr(json, "chatId")
                Dim eMsgId As String = JStr(json, "messageId")
                Dim eText As String = JStr(json, "text")
                Dim eVia As String = JStr(json, "via")
                Dim eReq As String = JStr(json, "reqId")
                Task.Run(Sub() EditPlatformMessage(ePlatform, eChatId, eMsgId, eText, eVia, eReq))
            Case "deleteMessages"
                Dim dPlatform As String = JStr(json, "platform")
                Dim dChatId As String = JStr(json, "chatId")
                Dim dVia As String = JStr(json, "via")
                Dim dReq As String = JStr(json, "reqId")
                Dim dIds As New List(Of String)
                Dim arr = TryCast(json("messageIds"), JArray)
                If arr IsNot Nothing Then
                    For Each t In arr
                        Dim v As String = t.ToString().Trim()
                        If v <> "" AndAlso Not dIds.Contains(v) Then dIds.Add(v)
                    Next
                End If
                Task.Run(Sub() DeletePlatformMessages(dPlatform, dChatId, dIds, dVia, dReq))
            Case "openMedia"
                OpenMedia(JStr(json, "url"), JStr(json, "name"))
            Case "saveMedia"
                SaveMediaAs(JStr(json, "url"), JStr(json, "name"))
            Case "sendChatAction"
                Dim platform As String = If(json("platform") IsNot Nothing, json("platform").ToString(), "")
                Dim chatId As String = If(json("chatId") IsNot Nothing, json("chatId").ToString(), "")
                Dim chatAct As String = If(json("chatAction") IsNot Nothing, json("chatAction").ToString(), "typing")
                Task.Run(Sub() SendPlatformChatAction(platform, chatId, chatAct))
            Case "markRead"
                Dim platform As String = If(json("platform") IsNot Nothing, json("platform").ToString(), "")
                Dim chatId As String = If(json("chatId") IsNot Nothing, json("chatId").ToString(), "")
                Dim maxId As Integer = 0
                If json("maxId") IsNot Nothing Then Integer.TryParse(json("maxId").ToString(), maxId)
                Task.Run(Sub() SendPlatformMarkRead(platform, chatId, maxId))
            Case "resolvePeer"
                ' JS warm-up: resolve a peer so the .NET send cache is populated.
                ' Called staggered on connect for all known Telegram contacts,
                ' and pro-actively before a scheduled/proactive send.
                '
                ' BUG FIX: this used to never report back. The JS side
                ' (ghost-message_send in bot-engine.jsx) listens for a
                ' "peerResolved" bcEvent and only proceeds early if it hears
                ' one — otherwise it always burns its full 3s fallback
                ' timeout before sending, even when resolution (often just
                ' an in-memory cache hit) finishes in milliseconds. That
                ' silent gap was the entire "scheduled message goes out a
                ' few seconds late" symptom. Posting the result back here,
                ' every time, lets the JS side proceed the instant it's
                ' actually known instead of always waiting out the clock.
                Dim rPlatform As String = If(json("platform") IsNot Nothing, json("platform").ToString(), "")
                Dim rChatId As String = If(json("chatId") IsNot Nothing, json("chatId").ToString(), "")
                Dim rHandle As String = If(json("handle") IsNot Nothing, json("handle").ToString(), "")
                If rPlatform = "telegram" Then
                    Task.Run(Async Function()
                                 Dim ok As Boolean = False
                                 Try
                                     Dim pid As Long
                                     If Long.TryParse(rChatId, pid) Then
                                         Dim resolvedPeer As TL.InputPeer = Await ResolveTelegramPeerFull(pid, rHandle)
                                         ok = resolvedPeer IsNot Nothing
                                     End If
                                 Catch
                                     ok = False
                                 End Try
                                 PostToJS("peerResolved", New With {.platform = rPlatform, .chatId = rChatId, .ok = ok})
                             End Function)
                End If
            Case "blockUser"
                Dim bPlatform As String = If(json("platform") IsNot Nothing, json("platform").ToString(), "")
                Dim bChatId As String = If(json("chatId") IsNot Nothing, json("chatId").ToString(), "")
                Task.Run(Sub() BlockPlatformUser(bPlatform, bChatId))
            Case "unblockUser"
                Dim uPlatform As String = If(json("platform") IsNot Nothing, json("platform").ToString(), "")
                Dim uChatId As String = If(json("chatId") IsNot Nothing, json("chatId").ToString(), "")
                Task.Run(Sub() UnblockPlatformUser(uPlatform, uChatId))
            Case "syncMissed"
                ' Sent by the page after a platform reconnects following an
                ' outage. since = last known-good moment, ms since epoch.
                ' The Bot API catches up on its own (Telegram holds a bot's
                ' updates while it is away), so only the User API needs this.
                Dim smPlatform As String = JStr(json, "platform")
                Dim smSince As Long = 0
                Long.TryParse(JStr(json, "since"), smSince)
                If smPlatform = "telegram" AndAlso tgUserClient IsNot Nothing AndAlso tgUserConnected Then
                    Dim sinceUtc As DateTime = If(smSince > 0, DateTimeOffset.FromUnixTimeMilliseconds(smSince).UtcDateTime, _tgUserLastOkUtc)
                    Task.Run(Function() CatchUpTelegramUserAsync(sinceUtc))
                End If
            Case "jsLog"
                ' Dedicated JS→.NET log channel. Unlike the DevTools console
                ' listener (which drops level=log/debug/trace unless
                ' DEBUG_VERBOSE is on), these ALWAYS print — the front-end
                ' uses this for invoice/payment/delivery diagnostics that must
                ' be visible in the running app's output even in release mode.
                Dim lgLevel As String = If(json("level") IsNot Nothing, json("level").ToString(), "info")
                Dim lgMsg As String = If(json("msg") IsNot Nothing, json("msg").ToString(), "")
                Dim lgLine As String = "[js:" & lgLevel & "] " & lgMsg
                System.Diagnostics.Debug.WriteLine(lgLine)
                Try
                    Console.WriteLine(lgLine)
                Catch
                End Try
        End Select
    End Sub

    Private Sub PostToJS(eventName As String, payload As Object)
        Dim json As String
        Try
            json = JsonConvert.SerializeObject(New With {.bcEvent = eventName, .data = payload})
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[PostToJS] serialize failed for " & eventName & ": " & ex.Message)
            Return
        End Try
        Try
            If IsHandleCreated Then
                If InvokeRequired Then
                    BeginInvoke(Sub()
                                    Try
                                        WebView1.CoreWebView2.PostWebMessageAsJson(json)
                                    Catch
                                    End Try
                                End Sub)
                Else
                    WebView1.CoreWebView2.PostWebMessageAsJson(json)
                End If
            End If
        Catch
        End Try
    End Sub

#End Region

#Region "Telegram Bot API"

    Private Async Sub ConnectTelegramBot(token As String)
        If String.IsNullOrWhiteSpace(token) Then
            PostToJS("telegramStatus", New With {.connected = False, .error = "Token is empty."})
            Return
        End If
        Try
            DisconnectTelegram()
            tgToken = token
            tgBotClient = New TelegramBotClient(token)

            Dim botUser As Telegram.Bot.Types.User = Await tgBotClient.GetMeAsync()
            tgBotId = botUser.Id
            tgBotUsername = If(botUser.Username, "")

            Try
                ' Only the very first connect of this run clears the backlog.
                ' On a reconnect, the updates Telegram held for us are the
                ' messages that arrived while we were offline — keep them.
                Await tgBotClient.DeleteWebhookAsync(dropPendingUpdates:=Not _tgBotEverConnected)
            Catch
            End Try
            _tgBotEverConnected = True

            Dim avatarUrl As String = Await TryGetTelegramAvatarUrl(tgBotClient, botUser.Id, token)

            tgCts = New CancellationTokenSource()
            tgConnected = True
            ' Fresh connect — clear any lingering intentional-teardown flag so
            ' the supervised polling loop below is allowed to auto-reconnect.
            _tgBotIntentionalDisconnect = False

            Dim cts As CancellationTokenSource = tgCts
            Dim client As TelegramBotClient = tgBotClient
            Dim handler As New TgUpdateHandler(AddressOf OnTelegramUpdate, AddressOf OnTelegramError)

            ' ── Supervised polling loop with live auto-reconnect ──────────
            ' ReceiveAsync long-polls getUpdates. If the internet drops it
            ' throws; we catch, back off (2s → cap 30s), re-probe the Bot API
            ' with GetMe, and resume polling the moment the network returns —
            ' all without operator intervention. The loop only exits on a
            ' genuine cancel (operator Disconnect or a new connect superseding
            ' this session).
            Task.Run(Async Function()
                         Dim backoff As Integer = 0
                         While Not cts.IsCancellationRequested AndAlso Not _tgBotIntentionalDisconnect
                             ' VB forbids Await inside a Catch, so the Try only
                             ' wraps the receive call. On failure we record the
                             ' error and drop out to the reconnect/back-off block
                             ' below, which is where the Awaits live.
                             Dim dropErr As String = Nothing
                             Dim fatalCancel As Boolean = False
                             Try
                                 Dim opts As New ReceiverOptions() With {.AllowedUpdates = {}}
                                 Await client.ReceiveAsync(
                                     updateHandler:=handler,
                                     receiverOptions:=opts,
                                     cancellationToken:=cts.Token)
                                 ' Returned without throwing — only expected on
                                 ' cancellation; loop condition handles exit.
                             Catch tex As TaskCanceledException
                                 fatalCancel = True
                             Catch ocex As OperationCanceledException
                                 fatalCancel = True
                             Catch ex As Exception
                                 dropErr = ex.Message
                             End Try

                             If fatalCancel Then Exit While
                             If dropErr Is Nothing Then
                                 ' Clean return with no error — re-evaluate the
                                 ' loop condition (handles graceful cancellation).
                                 Continue While
                             End If

                             If cts.IsCancellationRequested OrElse _tgBotIntentionalDisconnect Then Exit While

                             ' ── Live reconnect (Awaits are OUTSIDE the Catch) ──
                             tgConnected = False
                             backoff += 1
                             Dim delayMs As Integer = Math.Min(2000 * backoff, 30_000)
                             ' .reconnecting = True tells the front-end that the
                             ' .NET host is already retrying, so its own auto-
                             ' reconnect timer should stand down and not fight this loop.
                             PostToJS("telegramStatus", New With {.connected = False, .reconnecting = True, .error = "Reconnecting…"})
                             PostToJS("platformLog", New With {.platform = "telegram", .level = "warn", .msg = "Bot API dropped — reconnecting in " & (delayMs \ 1000) & "s (" & dropErr & ")"})

                             Dim delayCancelled As Boolean = False
                             Try
                                 Await Task.Delay(delayMs, cts.Token)
                             Catch
                                 delayCancelled = True
                             End Try
                             If delayCancelled OrElse cts.IsCancellationRequested OrElse _tgBotIntentionalDisconnect Then Exit While

                             ' Probe the API. On success we announce the reconnect
                             ' and reset the back-off; on failure we loop straight
                             ' back into ReceiveAsync, which throws again quickly
                             ' and grows the back-off.
                             Dim probeUser As Telegram.Bot.Types.User = Nothing
                             Try
                                 probeUser = Await client.GetMeAsync(cts.Token)
                             Catch
                                 probeUser = Nothing
                             End Try
                             If probeUser IsNot Nothing Then
                                 tgConnected = True
                                 backoff = 0
                                 Dim uname2 As String = If(probeUser.Username IsNot Nothing, "@" & probeUser.Username, probeUser.Id.ToString())
                                 PostToJS("telegramStatus", New With {
                                     .connected = True,
                                     .botName = probeUser.FirstName,
                                     .username = uname2,
                                     .botId = probeUser.Id.ToString(),
                                     .avatar = ""
                                 })
                                 PostToJS("platformLog", New With {.platform = "telegram", .level = "ok", .msg = "Bot API reconnected as " & uname2})
                             End If
                         End While
                     End Function)

            Dim uname As String = If(botUser.Username IsNot Nothing, "@" & botUser.Username, botUser.Id.ToString())
            PostToJS("telegramStatus", New With {
                .connected = True,
                .botName = botUser.FirstName,
                .username = uname,
                .botId = botUser.Id.ToString(),
                .avatar = avatarUrl
            })
            PostToJS("platformLog", New With {.platform = "telegram", .level = "ok", .msg = "Bot API connected as " & uname})
        Catch ex As Exception
            tgConnected = False
            PostToJS("telegramStatus", New With {.connected = False, .error = ex.Message})
            PostToJS("platformLog", New With {.platform = "telegram", .level = "error", .msg = "Bot API connect failed: " & ex.Message})
        End Try
    End Sub

#End Region

#Region "Telegram User API (MTProto)"

    ' ── ConnectTelegramUser ──────────────────────────────────────────
    ' Full sign-in flow with session resumption, heartbeat supervision,
    ' and automatic recovery on transient drops or session expiry.
    Private Sub ConnectTelegramUser(apiId As String, apiHash As String, phone As String)
        If String.IsNullOrWhiteSpace(apiId) OrElse String.IsNullOrWhiteSpace(apiHash) OrElse String.IsNullOrWhiteSpace(phone) Then
            PostToJS("telegramStatus", New With {.connected = False, .error = "API ID, API Hash and Phone are required for User API."})
            Return
        End If
        Try
            DisconnectTelegramUser()

            tgUserApiId = apiId
            tgUserApiHash = apiHash
            tgUserPhone = phone

            Dim appDir As String = IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BotCommand")
            If Not IO.Directory.Exists(appDir) Then IO.Directory.CreateDirectory(appDir)

            Dim safePhone As String = New String(phone.Where(Function(c) Char.IsLetterOrDigit(c)).ToArray())
            tgUserSessionPath = IO.Path.Combine(appDir, "tg_user_" & safePhone & ".session")
            _peerCachePath = IO.Path.Combine(appDir, "tg_peer_" & safePhone & ".json")

            ' Load persisted peer cache from previous session.
            LoadPeerCacheFromDisk()

            tgUserCts = New CancellationTokenSource()
            tgUserClient = New WTelegram.Client(AddressOf TgUserConfigCallback)

            Task.Run(Async Function()
                         Try
                             Dim selfUser As TL.User = Await tgUserClient.LoginUserIfNeeded()
                             Dim selfBase As TL.UserBase = selfUser
                             Dim selfId As Long = selfBase.ID
                             tgUserSelfId = selfId
                             tgUserSelfUsername = If(selfUser.username, "")
                             tgUserConnected = True

                             Dim displayName As String = If(Not String.IsNullOrEmpty(selfUser.first_name),
                                 (selfUser.first_name & " " & If(selfUser.last_name, "")).Trim(),
                                 If(selfUser.username, selfId.ToString()))
                             Dim handle As String = If(Not String.IsNullOrEmpty(selfUser.username),
                                 "@" & selfUser.username, selfId.ToString())
                             _tgUserDisplayName = displayName
                             _tgUserHandle = handle
                             _tgUserLastOkUtc = DateTime.UtcNow

                             Try
                                 tgUserUpdateMgr = tgUserClient.WithUpdateManager(AddressOf OnTelegramUserUpdate)
                             Catch ex As Exception
                                 PostToJS("telegramError", New With {.error = "User API update manager failed: " & ex.Message})
                             End Try

                             PostToJS("telegramStatus", New With {
                                 .connected = True,
                                 .mode = "user",
                                 .botName = displayName,
                                 .username = handle,
                                 .botId = selfId.ToString(),
                                 .avatar = ""
                             })
                             PostToJS("platformLog", New With {.platform = "telegram", .level = "ok", .msg = "User API connected as " & handle})

                             ' Pre-warm: pull recent dialogs so every known contact's
                             ' InputPeer (including access_hash) is in our cache before
                             ' any cold outbound message is attempted.
                             Await WarmPeerCacheFromDialogs()

                             ' Mark the session online so Telegram keeps pushing typing
                             ' updates (see KeepTelegramUserOnline).
                             Await KeepTelegramUserOnline()

                             ' Start heartbeat + supervision loop.
                             StartTelegramUserSupervision()

                         Catch ex As Exception
                             tgUserConnected = False
                             FailAllAuthWaiters(ex.Message)
                             PostToJS("telegramStatus", New With {.connected = False, .error = "User API: " & ex.Message})
                             PostToJS("platformLog", New With {.platform = "telegram", .level = "error", .msg = "User API connect failed: " & ex.Message})
                             Try
                                 If tgUserClient IsNot Nothing Then tgUserClient.Dispose()
                             Catch
                             End Try
                             tgUserClient = Nothing
                         End Try
                     End Function)
        Catch ex As Exception
            tgUserConnected = False
            PostToJS("telegramStatus", New With {.connected = False, .error = "User API: " & ex.Message})
        End Try
    End Sub

    ' ── Heartbeat + auto-reconnect supervision loop ─────────────────
    ' Runs on a background thread for the lifetime of the User API session.
    ' Pings every 45 s to keep the MTProto DC connection alive.
    ' On any network error, attempts exponential back-off reconnect.
    ' On fatal auth errors (SESSION_REVOKED etc.), signals the operator.
    '
    ' A drop is now REPORTED to the page (telegramStatus reconnecting) —
    ' before, only a log line was written, so the page kept showing
    ' "connected" and kept sending into a dead socket. A recovery is
    ' verified with a ping, announced as connected again, and followed by
    ' a catch-up of anything that arrived while the link was down.
    Private Sub StartTelegramUserSupervision()
        SyncLock _tgUserReconnectLock
            If _tgUserReconnecting Then Return
            _tgUserReconnecting = True
        End SyncLock

        Dim cts As CancellationTokenSource = tgUserCts
        Task.Run(Async Function()
                     Dim attempt As Integer = 0
                     While tgUserConnected AndAlso Not cts.IsCancellationRequested
                         ' ── 45-second heartbeat delay ───────────────────────
                         Dim cancelled As Boolean = False
                         Try
                             Await Task.Delay(45_000, cts.Token)
                         Catch
                             cancelled = True
                         End Try
                         If cancelled OrElse cts.IsCancellationRequested Then Exit While

                         ' ── Ping to keep the MTProto DC connection alive ──
                         Dim pingOk As Boolean = True
                         Dim pingErr As String = ""
                         Try
                             If tgUserClient IsNot Nothing Then
                                 Await tgUserClient.Ping(CLng(Environment.TickCount And &H7FFFFFFF))
                                 attempt = 0
                                 _tgUserLastOkUtc = DateTime.UtcNow
                                 Await KeepTelegramUserOnline()
                             End If
                         Catch pingEx As Exception
                             pingOk = False
                             pingErr = pingEx.Message
                         End Try

                         If Not pingOk Then
                             If cts.IsCancellationRequested Then Exit While
                             System.Diagnostics.Debug.WriteLine("[TgUser] ping failed: " & pingErr)
                             PostToJS("platformLog", New With {.platform = "telegram", .level = "warn", .msg = "Ping failed — attempting reconnect (" & pingErr & ")"})

                             ' ── Classify the error ──────────────────────
                             Dim isFatal As Boolean = False
                             For Each fatalPhrase In New String() {
                                     "SESSION_REVOKED", "AUTH_KEY_UNREGISTERED",
                                     "SESSION_EXPIRED", "AUTH_KEY_DUPLICATED",
                                     "USER_DEACTIVATED", "USER_DEACTIVATED_BAN"}
                                 If pingErr.IndexOf(fatalPhrase, StringComparison.OrdinalIgnoreCase) >= 0 Then
                                     isFatal = True : Exit For
                                 End If
                             Next

                             If isFatal Then
                                 PostToJS("telegramStatus", New With {.connected = False, .error = "Session expired — please sign in again."})
                                 PostToJS("platformLog", New With {.platform = "telegram", .level = "error", .msg = "Fatal: " & pingErr & " — session file deleted, please re-authenticate."})
                                 Try
                                     If IO.File.Exists(tgUserSessionPath) Then IO.File.Delete(tgUserSessionPath)
                                 Catch
                                 End Try
                                 tgUserConnected = False
                                 Exit While
                             End If

                             ' ── Transient — tell the page, then back off (cap 60s) ─
                             If attempt = 0 Then
                                 PostToJS("telegramStatus", New With {.connected = False, .reconnecting = True, .error = "Reconnecting…"})
                             End If
                             attempt += 1
                             Dim delayMs As Integer = Math.Min(1000 * CInt(Math.Pow(2, Math.Min(attempt - 1, 10))), 60_000)
                             PostToJS("platformLog", New With {.platform = "telegram", .level = "warn", .msg = "Reconnecting in " & (delayMs \ 1000) & "s (attempt " & attempt & ")…"})

                             Dim delayCancelled As Boolean = False
                             Try
                                 Await Task.Delay(delayMs, cts.Token)
                             Catch
                                 delayCancelled = True
                             End Try
                             If delayCancelled OrElse cts.IsCancellationRequested Then Exit While

                             ' ── Reconnect attempt, verified with a ping ──────
                             Dim reconnOk As Boolean = False
                             Try
                                 If tgUserClient IsNot Nothing Then
                                     Await tgUserClient.ConnectAsync()
                                     Await tgUserClient.Ping(CLng(Environment.TickCount And &H7FFFFFFF))
                                     reconnOk = True
                                 End If
                             Catch reconnEx As Exception
                                 System.Diagnostics.Debug.WriteLine("[TgUser] reconnect attempt failed: " & reconnEx.Message)
                             End Try
                             If reconnOk Then
                                 attempt = 0
                                 Dim missedSince As DateTime = _tgUserLastOkUtc
                                 _tgUserLastOkUtc = DateTime.UtcNow
                                 Await KeepTelegramUserOnline()
                                 PostTelegramUserConnected()
                                 PostToJS("platformLog", New With {.platform = "telegram", .level = "ok", .msg = "Reconnected after transient drop."})
                                 Await CatchUpTelegramUserAsync(missedSince)
                             End If
                         End If
                     End While
                     ' Clear the flag outside the lock — no Await here so SyncLock is safe.
                     SyncLock _tgUserReconnectLock
                         _tgUserReconnecting = False
                     End SyncLock
                 End Function)
    End Sub

    Private Sub PostTelegramUserConnected()
        PostToJS("telegramStatus", New With {
            .connected = True, .mode = "user",
            .botName = _tgUserDisplayName, .username = _tgUserHandle,
            .botId = tgUserSelfId.ToString(), .avatar = ""
        })
    End Sub

    ' Copies users/chats from an API result into the UpdateManager's cache,
    ' so caught-up messages carry real names instead of bare ids. Done
    ' through IDictionary so it builds against any WTelegramClient version.
    Private Sub AbsorbUsersChats(container As Object)
        If tgUserUpdateMgr Is Nothing OrElse container Is Nothing Then Return
        Try
            Dim src = TryCast(ReadMember(container, "users"), IDictionary)
            Dim dst = TryCast(CObj(tgUserUpdateMgr.Users), IDictionary)
            If src IsNot Nothing AndAlso dst IsNot Nothing Then
                For Each k As Object In src.Keys
                    Dim u As TL.User = TryCast(src(k), TL.User)
                    If u IsNot Nothing AndAlso Not dst.Contains(CLng(k)) Then dst(CLng(k)) = u
                Next
            End If
        Catch
        End Try
        Try
            Dim src = TryCast(ReadMember(container, "chats"), IDictionary)
            Dim dst = TryCast(CObj(tgUserUpdateMgr.Chats), IDictionary)
            If src IsNot Nothing AndAlso dst IsNot Nothing Then
                For Each k As Object In src.Keys
                    Dim c As TL.ChatBase = TryCast(src(k), TL.ChatBase)
                    If c IsNot Nothing AndAlso Not dst.Contains(CLng(k)) Then dst(CLng(k)) = c
                Next
            End If
        Catch
        End Try
    End Sub

    ' ── Catch-up after an outage ─────────────────────────────────────
    ' Finds every dialog with activity since the last good moment, reads
    ' its recent history, and feeds each missed inbound message through
    ' the normal update handler, exactly as if it had arrived live (media
    ' download, reply detection, profile backfill all included). Messages
    ' already posted are skipped by _seenTgUserInbound. Looks back at most
    ' 24 hours, with a 2-minute overlap for clock skew.
    Private Async Function CatchUpTelegramUserAsync(sinceUtc As DateTime) As Task
        If tgUserClient Is Nothing OrElse Not tgUserConnected Then Return
        If Interlocked.CompareExchange(_tgCatchUpRunning, 1, 0) <> 0 Then Return
        Dim fed As Integer = 0
        Try
            Dim floor As DateTime = DateTime.UtcNow.AddHours(-24)
            If sinceUtc = DateTime.MinValue OrElse sinceUtc < floor Then sinceUtc = floor
            sinceUtc = sinceUtc.AddMinutes(-2)

            Dim dialogs = Await tgUserClient.Messages_GetDialogs(limit:=100)
            AbsorbUsersChats(dialogs)
            Dim tops = TryCast(ReadMember(dialogs, "messages"), TL.MessageBase())
            If tops Is Nothing Then Return

            Dim peers As New List(Of Long)
            For Each top As TL.MessageBase In tops
                If top Is Nothing OrElse top.Peer Is Nothing Then Continue For
                If top.Date > sinceUtc AndAlso Not peers.Contains(top.Peer.ID) Then peers.Add(top.Peer.ID)
            Next
            If peers.Count = 0 Then Return
            PostToJS("platformLog", New With {.platform = "telegram", .level = "info",
                                              .msg = "Catching up on " & peers.Count & " chat(s) with activity during the outage…"})

            For Each pid In peers
                If tgUserClient Is Nothing OrElse Not tgUserConnected Then Exit For
                Try
                    Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(pid)
                    If peer Is Nothing Then Continue For
                    Dim hist = Await tgUserClient.Messages_GetHistory(peer, limit:=30)
                    AbsorbUsersChats(hist)
                    Dim msgs = TryCast(ReadMember(hist, "messages"), TL.MessageBase())
                    If msgs Is Nothing Then Continue For
                    ' History comes newest-first; replay oldest-first.
                    For i As Integer = msgs.Length - 1 To 0 Step -1
                        Dim m As TL.Message = TryCast(msgs(i), TL.Message)
                        If m Is Nothing Then Continue For
                        Dim mb As TL.MessageBase = m
                        If mb.Date <= sinceUtc Then Continue For
                        Await OnTelegramUserUpdate(New TL.UpdateNewMessage With {.message = m})
                        fed += 1
                    Next
                Catch ex As Exception
                    System.Diagnostics.Debug.WriteLine("[TgUser] catch-up failed for " & pid & ": " & ex.Message)
                End Try
                Await Task.Delay(350)   ' stay well clear of flood limits
            Next
            PostToJS("platformLog", New With {.platform = "telegram", .level = "ok",
                                              .msg = "Catch-up done — " & fed & " message(s) checked."})
        Catch ex As Exception
            PostToJS("platformLog", New With {.platform = "telegram", .level = "warn", .msg = "Catch-up failed: " & ex.Message})
        Finally
            Interlocked.Exchange(_tgCatchUpRunning, 0)
        End Try
    End Function

    ' ── Keep the User API session "online" ──────────────────────────
    ' Telegram only pushes typing updates (UpdateUserTyping and friends) to
    ' sessions it considers ONLINE. Nothing ever told it this session was
    ' online, so a few minutes after the last send it went offline and the
    ' contact-list typing indicator went dead — until sending or reading a
    ' message woke it up again. account.updateStatus(offline:=false) on every
    ' heartbeat (45 s, well inside Telegram's ~5 min online window) keeps it
    ' alive. Side effect: the account shows "online" while the app runs,
    ' exactly as it would with Telegram Desktop open.
    Private Async Function KeepTelegramUserOnline() As Task
        Try
            If tgUserClient IsNot Nothing AndAlso tgUserConnected Then
                Await tgUserClient.Account_UpdateStatus(False)
            End If
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[TgUser] updateStatus failed: " & ex.Message)
        End Try
    End Function

    ' ── WTelegramClient config callback ─────────────────────────────
    Private Function TgUserConfigCallback(what As String) As String
        Select Case what.ToLowerInvariant()
            Case "api_id" : Return tgUserApiId
            Case "api_hash" : Return tgUserApiHash
            Case "phone_number" : Return tgUserPhone
            Case "session_pathname" : Return tgUserSessionPath
            Case "verification_code"
                PostToJS("telegramAuthRequired", New With {.kind = "code", .phone = tgUserPhone})
                PostToJS("platformLog", New With {.platform = "telegram", .level = "info", .msg = "OTP requested for " & tgUserPhone})
                Return WaitForAuthAnswer("verification_code")
            Case "password"
                PostToJS("telegramAuthRequired", New With {.kind = "password"})
                PostToJS("platformLog", New With {.platform = "telegram", .level = "info", .msg = "2FA password requested"})
                Return WaitForAuthAnswer("password")
            Case "first_name" : Return ""
            Case "last_name" : Return ""
            Case Else : Return Nothing
        End Select
    End Function

    Private Function WaitForAuthAnswer(key As String) As String
        Dim tcs As New TaskCompletionSource(Of String)(TaskCreationOptions.RunContinuationsAsynchronously)
        tgUserAuthAnswers(key) = tcs
        Try
            Return tcs.Task.GetAwaiter().GetResult()
        Catch ex As Exception
            Throw New OperationCanceledException("Telegram auth cancelled: " & ex.Message)
        End Try
    End Function

    Private Sub ProvideTelegramAuthAnswer(code As String, password As String)
        Dim tcs As TaskCompletionSource(Of String) = Nothing
        If Not String.IsNullOrEmpty(code) AndAlso tgUserAuthAnswers.TryRemove("verification_code", tcs) Then
            tcs.TrySetResult(code) : Return
        End If
        If Not String.IsNullOrEmpty(password) AndAlso tgUserAuthAnswers.TryRemove("password", tcs) Then
            tcs.TrySetResult(password) : Return
        End If
        If Not String.IsNullOrEmpty(password) AndAlso tgUserAuthAnswers.TryRemove("verification_code", tcs) Then
            tcs.TrySetResult(password)
        End If
    End Sub

    Private Sub CancelTelegramUserAuth()
        FailAllAuthWaiters("User cancelled")
        DisconnectTelegramUser()
        PostToJS("telegramStatus", New With {.connected = False, .error = "User API auth cancelled."})
    End Sub

    Private Sub FailAllAuthWaiters(reason As String)
        For Each kv In tgUserAuthAnswers.ToArray()
            Dim t As TaskCompletionSource(Of String) = Nothing
            If tgUserAuthAnswers.TryRemove(kv.Key, t) Then
                Try : t.TrySetException(New Exception(reason)) : Catch : End Try
            End If
        Next
    End Sub

    Private Sub DisconnectTelegramUser()
        Try
            FailAllAuthWaiters("Disconnected")
            If tgUserCts IsNot Nothing Then
                Try : tgUserCts.Cancel() : Catch : End Try
                Try : tgUserCts.Dispose() : Catch : End Try
                tgUserCts = Nothing
            End If
            If tgUserClient IsNot Nothing Then
                Try : tgUserClient.Dispose() : Catch : End Try
                tgUserClient = Nothing
            End If
            tgUserUpdateMgr = Nothing
            tgUserConnected = False
            tgUserSelfId = 0
            tgUserSelfUsername = ""
            SyncLock _tgUserReconnectLock
                _tgUserReconnecting = False
            End SyncLock
        Catch
        End Try
    End Sub

    ' ── Pre-warm peer cache from Messages_GetDialogs ─────────────────
    ' Pulls up to 200 most-recent dialogs right after login so every
    ' contact's InputPeer (including access_hash) is in the cache before
    ' any cold outbound is attempted. Staggered to avoid rate limiting.
    Private Async Function WarmPeerCacheFromDialogs() As Task
        Try
            If tgUserClient Is Nothing OrElse Not tgUserConnected Then Return
            PostToJS("platformLog", New With {.platform = "telegram", .level = "info", .msg = "Pre-warming peer cache from recent dialogs…"})
            Dim dialogs = Await tgUserClient.Messages_GetDialogs(limit:=200)
            If dialogs Is Nothing Then Return
            Dim count As Integer = 0
            ' WTelegramClient: Messages_DialogsBase exposes .Users and .Chats
            ' as Dictionary(Of Long, UserBase) / Dictionary(Of Long, ChatBase)
            ' on the base class itself (not just the concrete subtypes).
            Dim usersDict As IDictionary = Nothing
            Dim chatsDict As IDictionary = Nothing
            Try
                Dim uProp = dialogs.GetType().GetProperty("Users",
                    System.Reflection.BindingFlags.Public Or System.Reflection.BindingFlags.Instance Or System.Reflection.BindingFlags.IgnoreCase)
                If uProp IsNot Nothing Then usersDict = TryCast(uProp.GetValue(dialogs), IDictionary)
            Catch
            End Try
            Try
                Dim cProp = dialogs.GetType().GetProperty("Chats",
                    System.Reflection.BindingFlags.Public Or System.Reflection.BindingFlags.Instance Or System.Reflection.BindingFlags.IgnoreCase)
                If cProp IsNot Nothing Then chatsDict = TryCast(cProp.GetValue(dialogs), IDictionary)
            Catch
            End Try
            If usersDict IsNot Nothing Then
                For Each key As Object In usersDict.Keys
                    Try
                        Dim ub As TL.UserBase = TryCast(usersDict(key), TL.UserBase)
                        Dim u As TL.User = TryCast(ub, TL.User)
                        If u Is Nothing OrElse u.IsBot Then Continue For
                        Dim peer As TL.InputPeer = u.ToInputPeer()
                        If peer IsNot Nothing Then
                            _peerCache(CLng(key)) = peer
                            count += 1
                        End If
                    Catch
                    End Try
                Next
            End If
            If chatsDict IsNot Nothing Then
                For Each key As Object In chatsDict.Keys
                    Try
                        Dim cb As TL.ChatBase = TryCast(chatsDict(key), TL.ChatBase)
                        If cb IsNot Nothing Then
                            Dim peer As TL.InputPeer = cb.ToInputPeer()
                            If peer IsNot Nothing Then
                                _peerCache(CLng(key)) = peer
                                count += 1
                            End If
                        End If
                    Catch
                    End Try
                Next
            End If
            Await SavePeerCacheToDiskAsync()
            PostToJS("platformLog", New With {.platform = "telegram", .level = "ok", .msg = "Peer cache warmed: " & count & " peers loaded from dialogs."})
        Catch ex As Exception
            PostToJS("platformLog", New With {.platform = "telegram", .level = "warn", .msg = "Dialog warm failed (non-fatal): " & ex.Message})
        End Try
    End Function

    ' ── 4-Stage peer resolver ────────────────────────────────────────
    ' Returns an InputPeer for the given Telegram user/chat ID.
    ' Stage 1: our in-process _peerCache (populated from dialogs + previous activity)
    ' Stage 2: UpdateManager.Users/Chats (WTelegramClient's live session cache)
    ' Stage 3: Users_GetUsers(InputUser(id, 0)) — works for mutual contacts
    ' ── HANDLE NORMALISATION ─────────────────────────
    ''' <summary>
    ''' Canonical handle for storage: bare username, no leading @, no
    ''' surrounding whitespace. Returns "" when there is no real username,
    ''' which is the correct answer for a Telegram account that never set
    ''' one. NEVER substitutes a numeric id.
    ''' Mirrors bc_handle_norm() in api.php and normHandle() in bot-core.jsx.
    ''' </summary>
    Private Function NormalizeHandle(rawUsername As String) As String
        If String.IsNullOrWhiteSpace(rawUsername) Then Return ""
        Dim s As String = rawUsername.Trim()
        ' Zero-width characters get pasted in from desktop clients.
        s = s.Replace(ChrW(&H200B), "").Replace(ChrW(&H200C), "").
              Replace(ChrW(&H200D), "").Replace(ChrW(&HFEFF), "").
              Replace(ChrW(&HA0), " ").Trim()
        s = s.TrimStart("@"c).Trim()
        ' A username is never all digits and never contains whitespace.
        ' If it is either, it is an id or a display name, not a handle.
        If s.Length = 0 Then Return ""
        If s.All(Function(c) Char.IsDigit(c)) Then Return ""
        If s.Any(Function(c) Char.IsWhiteSpace(c)) Then Return ""
        Return s
    End Function

    ''' <summary>
    ''' Discord's Username is the canonical handle. Since the 2023 move to
    ''' unique usernames the discriminator is "0" on every migrated
    ''' account, so only keep one when it is a genuine legacy value.
    ''' </summary>
    Private Function NormalizeDiscordHandle(username As String, discriminator As String) As String
        Dim baseName As String = NormalizeHandle(username)
        If baseName = "" Then Return ""
        Dim d As String = If(discriminator, "").Trim()
        If d = "" OrElse d = "0" OrElse d = "0000" Then Return baseName
        Return baseName & "#" & d
    End Function

    ' Stage 4: Contacts_ResolveUsername if a @handle is known
    ' Writes successful results back into _peerCache and persists to disk.
    Private Async Function ResolveTelegramPeerFull(userId As Long, Optional handle As String = "") As Task(Of TL.InputPeer)
        ' Stage 1 — persistent cache
        Dim cached As TL.InputPeer = Nothing
        If _peerCache.TryGetValue(userId, cached) Then Return cached

        ' Stage 2 — UpdateManager live session
        If tgUserUpdateMgr IsNot Nothing Then
            If tgUserUpdateMgr.Users.ContainsKey(userId) Then
                Dim p As TL.InputPeer = tgUserUpdateMgr.Users(userId)
                If p IsNot Nothing Then
                    _peerCache(userId) = p
                    SavePeerCacheToDiskDeferred()
                    Return p
                End If
            End If
            If tgUserUpdateMgr.Chats.ContainsKey(userId) Then
                Dim p As TL.InputPeer = tgUserUpdateMgr.Chats(userId)
                If p IsNot Nothing Then
                    _peerCache(userId) = p
                    SavePeerCacheToDiskDeferred()
                    Return p
                End If
            End If
        End If

        If tgUserClient Is Nothing OrElse Not tgUserConnected Then Return Nothing

        ' Stage 3 — Users_GetUsers with access_hash=0 (works for mutual contacts)
        Try
            Dim inputUser As New TL.InputUser(userId, 0L)
            Dim usersResult = Await tgUserClient.Users_GetUsers(New TL.InputUserBase() {inputUser})
            If usersResult IsNot Nothing AndAlso usersResult.Length > 0 Then
                ' UserBase subclasses: TL.User (real user) and TL.UserEmpty (deleted/unknown).
                ' TryCast to TL.User already excludes UserEmpty since they are sibling types.
                Dim resolved As TL.User = TryCast(usersResult(0), TL.User)
                If resolved IsNot Nothing Then
                    Dim p As TL.InputPeer = resolved.ToInputPeer()
                    If p IsNot Nothing Then
                        _peerCache(userId) = p
                        SavePeerCacheToDiskDeferred()
                        Return p
                    End If
                End If
            End If
        Catch
        End Try

        ' Stage 4 — Contacts_ResolveUsername (requires a non-empty @handle)
        Dim cleanHandle As String = If(handle, "").TrimStart("@"c).Trim()
        If Not String.IsNullOrEmpty(cleanHandle) Then
            Try
                Dim resolved = Await tgUserClient.Contacts_ResolveUsername(cleanHandle)
                If resolved IsNot Nothing AndAlso resolved.peer IsNot Nothing Then
                    If resolved.users IsNot Nothing Then
                        For Each kv In resolved.users
                            Dim u As TL.User = TryCast(kv.Value, TL.User)
                            If u IsNot Nothing Then
                                Dim p As TL.InputPeer = u.ToInputPeer()
                                If p IsNot Nothing Then
                                    ' Read u.id via the UserBase property to avoid BC31429 ambiguity
                                    Dim uBase As TL.UserBase = u
                                    Dim uid As Long = uBase.ID
                                    _peerCache(uid) = p
                                    SavePeerCacheToDiskDeferred()
                                    If uid = userId Then Return p
                                End If
                            End If
                        Next
                    End If
                    If resolved.chats IsNot Nothing Then
                        For Each kv In resolved.chats
                            Dim p As TL.InputPeer = kv.Value.ToInputPeer()
                            If p IsNot Nothing Then
                                _peerCache(kv.Key) = p
                                SavePeerCacheToDiskDeferred()
                                If kv.Key = userId Then Return p
                            End If
                        Next
                    End If
                End If
            Catch
            End Try
        End If

        Return Nothing
    End Function

    ' ── Peer cache persistence ───────────────────────────────────────
    ' Saves the cache as JSON: { "123456": { "type": "user", "userId": 123456, "accessHash": 789 }, … }
    ' Only serialises InputPeerUser and InputPeerChat / InputPeerChannel — the types we can reconstruct.
    Private _peerCacheSaveQueued As Integer = 0   ' 0 = idle, 1 = pending
    Private Sub SavePeerCacheToDiskDeferred()
        ' Coalesce rapid writes into a single disk I/O 2 s later.
        If Interlocked.CompareExchange(_peerCacheSaveQueued, 1, 0) = 0 Then
            Task.Run(Async Function()
                         Await Task.Delay(2000)
                         Interlocked.Exchange(_peerCacheSaveQueued, 0)
                         Await SavePeerCacheToDiskAsync()
                     End Function)
        End If
    End Sub

    Private Async Function SavePeerCacheToDiskAsync() As Task
        If String.IsNullOrEmpty(_peerCachePath) Then Return
        Await _peerCacheLock.WaitAsync()
        Try
            Dim rows As New JObject()
            For Each kv In _peerCache
                Dim peer = kv.Value
                Dim row As New JObject()
                If TypeOf peer Is TL.InputPeerUser Then
                    Dim u = CType(peer, TL.InputPeerUser)
                    row("type") = "user"
                    row("userId") = u.user_id
                    row("accessHash") = u.access_hash
                ElseIf TypeOf peer Is TL.InputPeerChat Then
                    Dim c = CType(peer, TL.InputPeerChat)
                    row("type") = "chat"
                    row("chatId") = c.chat_id
                ElseIf TypeOf peer Is TL.InputPeerChannel Then
                    Dim ch = CType(peer, TL.InputPeerChannel)
                    row("type") = "channel"
                    row("channelId") = ch.channel_id
                    row("accessHash") = ch.access_hash
                Else
                    Continue For
                End If
                rows(kv.Key.ToString()) = row
            Next
            IO.File.WriteAllText(_peerCachePath, rows.ToString(Newtonsoft.Json.Formatting.None), System.Text.Encoding.UTF8)
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[PeerCache] save failed: " & ex.Message)
        Finally
            _peerCacheLock.Release()
        End Try
    End Function

    ' Synchronous wrapper used at shutdown (fire-and-forget is fine there).
    Private Sub SavePeerCacheToDisk()
        Task.Run(Function() SavePeerCacheToDiskAsync()).Wait(3000)
    End Sub

    Private Sub LoadPeerCacheFromDisk()
        If String.IsNullOrEmpty(_peerCachePath) OrElse Not IO.File.Exists(_peerCachePath) Then Return
        Try
            Dim text As String = IO.File.ReadAllText(_peerCachePath, System.Text.Encoding.UTF8)
            Dim rows As JObject = JObject.Parse(text)
            Dim loaded As Integer = 0
            For Each prop As JProperty In rows.Properties()
                Try
                    Dim id As Long
                    If Not Long.TryParse(prop.Name, id) Then Continue For
                    Dim row As JObject = TryCast(prop.Value, JObject)
                    If row Is Nothing Then Continue For
                    Dim typeTok = row("type")
                    Dim t As String = If(typeTok IsNot Nothing, typeTok.ToString(), "")
                    Dim peer As TL.InputPeer = Nothing
                    Select Case t
                        Case "user"
                            Dim uidTok = row("userId")
                            Dim ahTok = row("accessHash")
                            Dim uid As Long = If(uidTok IsNot Nothing, uidTok.ToObject(Of Long)(), 0L)
                            Dim ah As Long = If(ahTok IsNot Nothing, ahTok.ToObject(Of Long)(), 0L)
                            peer = New TL.InputPeerUser(uid, ah)
                        Case "chat"
                            Dim cidTok = row("chatId")
                            Dim cid As Long = If(cidTok IsNot Nothing, cidTok.ToObject(Of Long)(), 0L)
                            peer = New TL.InputPeerChat(cid)
                        Case "channel"
                            Dim chIdTok = row("channelId")
                            Dim ahTok = row("accessHash")
                            Dim chId As Long = If(chIdTok IsNot Nothing, chIdTok.ToObject(Of Long)(), 0L)
                            Dim ah As Long = If(ahTok IsNot Nothing, ahTok.ToObject(Of Long)(), 0L)
                            peer = New TL.InputPeerChannel(chId, ah)
                    End Select
                    If peer IsNot Nothing Then
                        _peerCache(id) = peer
                        loaded += 1
                    End If
                Catch
                End Try
            Next
            System.Diagnostics.Debug.WriteLine("[PeerCache] loaded " & loaded & " peers from disk")
        Catch ex As Exception
            System.Diagnostics.Debug.WriteLine("[PeerCache] load failed: " & ex.Message)
        End Try
    End Sub

    ' ── User API avatar helper ────────────────────────────────────────
    Private Async Function TryGetUserApiAvatarDataUri(userId As Long) As Task(Of String)
        Try
            If tgUserClient Is Nothing OrElse Not tgUserConnected Then Return ""
            If tgUserUpdateMgr Is Nothing OrElse Not tgUserUpdateMgr.Users.ContainsKey(userId) Then Return ""
            Dim u As TL.User = tgUserUpdateMgr.Users(userId)
            If u Is Nothing OrElse u.photo Is Nothing Then Return ""
            Dim ms As New IO.MemoryStream()
            Dim mimeType As String = Await tgUserClient.DownloadProfilePhotoAsync(u, ms, False)
            If String.IsNullOrEmpty(mimeType) OrElse ms.Length = 0 Then Return ""
            Return "data:" & mimeType & ";base64," & Convert.ToBase64String(ms.ToArray())
        Catch
            Return ""
        End Try
    End Function

    ' Storage_FileType is an enum whose exact namespace has moved between
    ' WTelegramClient versions, so it is taken as Object and read by name.
    Private Function StorageFileTypeToMime(ft As Object) As String
        Dim n As String = ""
        Try : n = ft.ToString().ToLowerInvariant() : Catch : End Try
        Select Case n
            Case "jpeg" : Return "image/jpeg"
            Case "png" : Return "image/png"
            Case "gif" : Return "image/gif"
            Case "webp" : Return "image/webp"
            Case "mp4" : Return "video/mp4"
            Case "mov" : Return "video/quicktime"
            Case "mp3" : Return "audio/mpeg"
            Case "pdf" : Return "application/pdf"
            Case Else : Return "image/jpeg"
        End Select
    End Function

    ' ── User API attachment description ──────────────────────────────
    ' What an attachment is, before downloading it. The same
    ' MessageMediaDocument wraps a PDF, a zip, a video, a voice note, a GIF
    ' and a sticker — the real kind is in the document attributes.
    '
    ' THE "[Document]" BUG: the old path refused anything over 3 MB and
    ' returned no URL at all, so a customer's PDF showed as the bare
    ' "[Document]" label with nothing to open. Documents are now fetched up
    ' to MEDIA_MAX_BYTES; big ones go to the local media cache.
    Private Function DescribeUserApiMedia(media As TL.MessageMedia) _
            As (kind As String, name As String, size As Long, mime As String, downloadable As Boolean)
        Try
            If media Is Nothing Then Return ("", "", 0, "", False)
            If TypeOf media Is TL.MessageMediaPhoto Then
                Dim mp As TL.MessageMediaPhoto = CType(media, TL.MessageMediaPhoto)
                Return ("photo", "", 0, "image/jpeg", TryCast(mp.photo, TL.Photo) IsNot Nothing)
            End If
            If TypeOf media Is TL.MessageMediaDocument Then
                Dim md As TL.MessageMediaDocument = CType(media, TL.MessageMediaDocument)
                Dim doc As TL.Document = TryCast(md.document, TL.Document)
                If doc Is Nothing Then Return ("document", "", 0, "", False)
                Dim fname As String = ""
                Dim kind As String = "document"
                Dim isSticker As Boolean = False
                Try
                    If doc.attributes IsNot Nothing Then
                        For Each at In doc.attributes
                            If TypeOf at Is TL.DocumentAttributeFilename Then
                                fname = CType(at, TL.DocumentAttributeFilename).file_name
                            ElseIf TypeOf at Is TL.DocumentAttributeAnimated Then
                                kind = "animation"
                            ElseIf TypeOf at Is TL.DocumentAttributeVideo Then
                                If kind <> "animation" Then kind = "video"
                            ElseIf TypeOf at Is TL.DocumentAttributeAudio Then
                                kind = "audio"
                            ElseIf TypeOf at Is TL.DocumentAttributeSticker Then
                                isSticker = True
                            End If
                        Next
                    End If
                Catch
                End Try
                Dim mime As String = If(String.IsNullOrEmpty(doc.mime_type), "application/octet-stream", doc.mime_type)
                If isSticker Then
                    ' Static (webp) and video (webm) stickers render; animated
                    ' .tgs (Lottie) stickers can't, so they stay a file.
                    If mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase) Then
                        kind = "sticker"
                    ElseIf mime.StartsWith("video/", StringComparison.OrdinalIgnoreCase) Then
                        kind = "video"
                    Else
                        kind = "document"
                        If fname = "" Then fname = "sticker.tgs"
                    End If
                End If
                ' An image sent with "send as file" is still worth showing.
                If kind = "document" AndAlso mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase) Then kind = "photo"
                If fname = "" AndAlso kind = "document" Then fname = "file" & ExtForMime(mime)
                Return (kind, fname, doc.size, mime, True)
            End If
            ' Link previews are not attachments — the text carries the link.
            If TypeOf media Is TL.MessageMediaWebPage Then Return ("", "", 0, "", False)
            Return ("media", "", 0, "", False)
        Catch
            Return ("", "", 0, "", False)
        End Try
    End Function

    ' Downloads a User API attachment and returns a URL for it (data: URL,
    ' or the local media host for big files). "" on failure.
    Private Async Function DownloadUserApiMediaAsync(media As TL.MessageMedia, fileName As String) As Task(Of String)
        Try
            If tgUserClient Is Nothing OrElse Not tgUserConnected OrElse media Is Nothing Then Return ""
            If TypeOf media Is TL.MessageMediaPhoto Then
                Dim ph As TL.Photo = TryCast(CType(media, TL.MessageMediaPhoto).photo, TL.Photo)
                If ph Is Nothing Then Return ""
                Using ms As New IO.MemoryStream()
                    Dim ft As Object = Await tgUserClient.DownloadFileAsync(ph, ms)
                    If ms.Length = 0 OrElse ms.Length > MEDIA_MAX_BYTES Then Return ""
                    Return StoreInboundMedia(ms.ToArray(), StorageFileTypeToMime(ft), "")
                End Using
            End If
            If TypeOf media Is TL.MessageMediaDocument Then
                Dim doc As TL.Document = TryCast(CType(media, TL.MessageMediaDocument).document, TL.Document)
                If doc Is Nothing OrElse doc.size > MEDIA_MAX_BYTES Then Return ""
                Dim mime As String = If(String.IsNullOrEmpty(doc.mime_type), "application/octet-stream", doc.mime_type)
                Using ms As New IO.MemoryStream()
                    Await tgUserClient.DownloadFileAsync(doc, ms)
                    If ms.Length = 0 Then Return ""
                    Return StoreInboundMedia(ms.ToArray(), mime, fileName)
                End Using
            End If
        Catch ex As Exception
            PostToJS("platformLog", New With {.platform = "telegram", .level = "error",
                                              .msg = "Attachment download failed: " & ex.Message})
        End Try
        Return ""
    End Function

    ' Big attachment: the message is already on screen with a "downloading"
    ' chip; this fills it in. The page matches it by uid and saves the URL.
    Private Sub DownloadInBackground(platform As String, chatId As String, messageId As String, uid As String,
                                     mediaType As String, fileName As String,
                                     fetch As Func(Of Task(Of String)))
        Task.Run(Async Function()
                     Dim url As String = ""
                     Dim errMsg As String = ""
                     Try
                         url = Await fetch()
                     Catch ex As Exception
                         errMsg = ex.Message
                     End Try
                     PostToJS("mediaReady", New With {
                         .platform = platform, .chatId = chatId, .messageId = messageId, .uid = uid,
                         .mediaType = mediaType, .fileName = fileName, .mediaUrl = url,
                         .ok = Not String.IsNullOrEmpty(url),
                         .error = If(String.IsNullOrEmpty(url), If(errMsg = "", "Download failed", errMsg), "")
                     })
                 End Function)
    End Sub

    ' ── Message identity helpers (User API) ─────────────────────────
    Private Function TgMessageIsOut(m As Object) As Boolean
        Try
            Dim flagsVal As Object = ReadMember(m, "flags")
            If flagsVal IsNot Nothing Then Return (Convert.ToInt64(flagsVal) And 2L) <> 0
        Catch
        End Try
        Return False
    End Function

    ' ── Edits and deletions (User API) ───────────────────────────────
    ' Telegram reports an edit as the whole message again. It also sends
    ' UpdateEditMessage for things that are not edits (reactions, view
    ' counts, link previews resolving), which carry no edit_date — those are
    ' dropped here, and the page ignores anything whose text didn't change.
    ' Covers the customer's edits AND the operator's own edits made from
    ' the Telegram app on a phone.
    Private Function HandleTelegramUserEdit(update As TL.Update) As Boolean
        If Not (TypeOf update Is TL.UpdateEditMessage) AndAlso
           Not (update IsNot Nothing AndAlso update.GetType().Name = "UpdateEditChannelMessage") Then Return False
        Try
            Dim em As TL.Message = TryCast(ReadMember(update, "message"), TL.Message)
            If em Is Nothing OrElse em.peer_id Is Nothing Then Return True
            Dim ed As Object = ReadMember(em, "edit_date")
            If ed IsNot Nothing AndAlso TypeOf ed Is DateTime AndAlso CType(ed, DateTime) <= New DateTime(2000, 1, 1) Then Return True
            Dim mb As TL.MessageBase = em
            Dim chatId As String = em.peer_id.ID.ToString()
            PostToJS("messageEdited", New With {
                .platform = "telegram", .chatId = chatId,
                .messageId = mb.ID.ToString(),
                .uid = "tgu:" & chatId & ":" & mb.ID.ToString(),
                .text = If(em.message, ""),
                .isOut = TgMessageIsOut(em),
                .via = "user"
            })
        Catch ex As Exception
            PostToJS("platformLog", New With {.platform = "telegram", .level = "warn", .msg = "Edit update: " & ex.Message})
        End Try
        Return True
    End Function

    ' Private chats and basic groups report deletions by message id only —
    ' ids there are unique per account, so no chat id is sent and the page
    ' matches across chats. Supergroups/channels include their channel id.
    Private Function HandleTelegramUserDelete(update As TL.Update) As Boolean
        If Not (TypeOf update Is TL.UpdateDeleteMessages) AndAlso
           Not (update IsNot Nothing AndAlso update.GetType().Name = "UpdateDeleteChannelMessages") Then Return False
        Try
            Dim ids As New List(Of String)
            Dim arr = TryCast(ReadMember(update, "messages"), Integer())
            If arr IsNot Nothing Then
                For Each i In arr
                    ids.Add(i.ToString())
                Next
            End If
            If ids.Count = 0 Then Return True
            Dim channelId As Long = ReadLong(update, "channel_id")
            PostToJS("messagesDeleted", New With {
                .platform = "telegram",
                .chatId = If(channelId <> 0, channelId.ToString(), ""),
                .messageIds = ids,
                .prefix = "tgu"
            })
        Catch ex As Exception
            PostToJS("platformLog", New With {.platform = "telegram", .level = "warn", .msg = "Delete update: " & ex.Message})
        End Try
        Return True
    End Function

    ' ── Typing forwarding ────────────────────────────────────────────
    ' Sends what the customer is doing to the contact list. Telegram's
    ' explicit cancel (draft cleared, app left) goes out as stop=True so the
    ' indicator ends at once instead of lingering for the 6-second window.
    ' Activity that isn't someone composing (emoji reactions, "seen",
    ' group-call speaking, game play) is ignored.
    Private Sub ForwardTelegramTyping(chatId As Long, whoId As Long, action As TL.SendMessageAction)
        If chatId = 0 OrElse action Is Nothing Then Return
        If whoId <> 0 AndAlso tgUserSelfId <> 0 AndAlso whoId = tgUserSelfId Then Return
        Dim key As String = TelegramTypingKey(action)
        If key Is Nothing Then Return
        If key = "cancel" Then
            PostToJS("userTyping", New With {.platform = "telegram", .chatId = chatId.ToString(), .stop = True})
        Else
            PostToJS("userTyping", New With {.platform = "telegram", .chatId = chatId.ToString(), .ms = 6000, .action = key})
        End If
    End Sub

    ' Maps Telegram's activity to the key the contact list understands.
    ' Nothing = not a composing activity, don't forward.
    Private Function TelegramTypingKey(action As TL.SendMessageAction) As String
        If TypeOf action Is TL.SendMessageCancelAction Then Return "cancel"
        If TypeOf action Is TL.SendMessageTypingAction Then Return "typing"
        If TypeOf action Is TL.SendMessageRecordAudioAction Then Return "record_voice"
        If TypeOf action Is TL.SendMessageUploadAudioAction Then Return "upload_voice"
        If TypeOf action Is TL.SendMessageUploadPhotoAction Then Return "upload_photo"
        If TypeOf action Is TL.SendMessageRecordVideoAction Then Return "record_video"
        If TypeOf action Is TL.SendMessageUploadVideoAction Then Return "upload_video"
        If TypeOf action Is TL.SendMessageRecordRoundAction Then Return "record_round"
        If TypeOf action Is TL.SendMessageUploadRoundAction Then Return "upload_round"
        If TypeOf action Is TL.SendMessageUploadDocumentAction Then Return "upload_document"
        If TypeOf action Is TL.SendMessageChooseStickerAction Then Return "choose_sticker"
        If TypeOf action Is TL.SendMessageChooseContactAction Then Return "choose_contact"
        If TypeOf action Is TL.SendMessageGeoLocationAction Then Return "geo"
        Return Nothing
    End Function

    ' ── Inbound message pump (User API) ──────────────────────────────
    Private Async Function OnTelegramUserUpdate(update As TL.Update) As Task
        Try
            ' ── Typing / activity forwarding ────────────────────────────
            ' Private chats report UpdateUserTyping, basic groups
            ' UpdateChatUserTyping, supergroups UpdateChannelUserTyping. The
            ' chat id sent is the same one newMessage uses for that chat.
            If TypeOf update Is TL.UpdateUserTyping Then
                Dim ut As TL.UpdateUserTyping = CType(update, TL.UpdateUserTyping)
                ForwardTelegramTyping(ut.user_id, ut.user_id, ut.action)
                Return
            End If
            If TypeOf update Is TL.UpdateChatUserTyping Then
                Dim gt As TL.UpdateChatUserTyping = CType(update, TL.UpdateChatUserTyping)
                Dim gWho As Long = If(gt.from_id IsNot Nothing, gt.from_id.ID, 0L)
                ForwardTelegramTyping(gt.chat_id, gWho, gt.action)
                Return
            End If
            If TypeOf update Is TL.UpdateChannelUserTyping Then
                Dim sgt As TL.UpdateChannelUserTyping = CType(update, TL.UpdateChannelUserTyping)
                Dim sWho As Long = If(sgt.from_id IsNot Nothing, sgt.from_id.ID, 0L)
                ForwardTelegramTyping(sgt.channel_id, sWho, sgt.action)
                Return
            End If

            ' ── Edits and deletions ─────────────────────────────────────
            If HandleTelegramUserEdit(update) Then Return
            If HandleTelegramUserDelete(update) Then Return

            Dim newMsg As TL.Message = Nothing
            If TypeOf update Is TL.UpdateNewMessage Then
                newMsg = TryCast(CType(update, TL.UpdateNewMessage).message, TL.Message)
            ElseIf TypeOf update Is TL.UpdateNewChannelMessage Then
                newMsg = TryCast(CType(update, TL.UpdateNewChannelMessage).message, TL.Message)
            End If
            If newMsg Is Nothing Then Return

            Dim msgBase As TL.MessageBase = newMsg
            Dim msgId As Integer = msgBase.ID

            ' Skip outgoing — read "out" flag via reflection to avoid VB BC31429.
            Dim msgIsOut As Boolean = False
            Try
                Dim fi = newMsg.GetType().GetField("flags",
                    System.Reflection.BindingFlags.Public Or
                    System.Reflection.BindingFlags.NonPublic Or
                    System.Reflection.BindingFlags.Instance Or
                    System.Reflection.BindingFlags.IgnoreCase)
                If fi IsNot Nothing Then
                    Dim flagsVal As Object = fi.GetValue(newMsg)
                    If flagsVal IsNot Nothing Then
                        msgIsOut = (Convert.ToInt32(flagsVal) And 2) <> 0
                    End If
                End If
            Catch
            End Try
            If msgIsOut Then Return

            Dim fromId As Long = 0
            If newMsg.From IsNot Nothing Then fromId = newMsg.From.ID
            If tgUserSelfId <> 0 AndAlso fromId = tgUserSelfId Then Return

            ' Skip bot senders to avoid loops
            If fromId <> 0 AndAlso tgUserUpdateMgr IsNot Nothing _
                    AndAlso tgUserUpdateMgr.Users.ContainsKey(fromId) Then
                Try
                    Dim sender As TL.User = tgUserUpdateMgr.Users(fromId)
                    If sender IsNot Nothing AndAlso sender.IsBot Then Return
                Catch
                End Try
            End If

            ' Update peer cache from live update (these have current access_hashes)
            If tgUserUpdateMgr IsNot Nothing Then
                If fromId <> 0 AndAlso tgUserUpdateMgr.Users.ContainsKey(fromId) Then
                    _peerCache(fromId) = tgUserUpdateMgr.Users(fromId)
                End If
            End If

            ' Resolve chat metadata
            Dim chatId As Long = 0
            Dim chatType As String = "private"
            Dim convName As String = ""
            Dim handle As String = ""

            If newMsg.peer_id IsNot Nothing Then
                chatId = newMsg.peer_id.ID
                If TypeOf newMsg.peer_id Is TL.PeerUser Then
                    chatType = "private"
                    If tgUserUpdateMgr IsNot Nothing AndAlso tgUserUpdateMgr.Users.ContainsKey(chatId) Then
                        Dim u As TL.User = tgUserUpdateMgr.Users(chatId)
                        convName = (If(u.first_name, "") & " " & If(u.last_name, "")).Trim()
                        If String.IsNullOrEmpty(convName) Then convName = If(u.username, chatId.ToString())
                        handle = NormalizeHandle(u.username)
                        ' Cache the peer from the live update
                        _peerCache(chatId) = tgUserUpdateMgr.Users(chatId)
                    End If
                ElseIf TypeOf newMsg.peer_id Is TL.PeerChat Then
                    chatType = "group"
                    If tgUserUpdateMgr IsNot Nothing AndAlso tgUserUpdateMgr.Chats.ContainsKey(chatId) Then
                        convName = tgUserUpdateMgr.Chats(chatId).Title
                        _peerCache(chatId) = tgUserUpdateMgr.Chats(chatId)
                    End If
                ElseIf TypeOf newMsg.peer_id Is TL.PeerChannel Then
                    chatType = "supergroup"
                    If tgUserUpdateMgr IsNot Nothing AndAlso tgUserUpdateMgr.Chats.ContainsKey(chatId) Then
                        Dim c = tgUserUpdateMgr.Chats(chatId)
                        convName = c.Title
                        _peerCache(chatId) = tgUserUpdateMgr.Chats(chatId)
                        If TypeOf c Is TL.Channel Then
                            If CType(c, TL.Channel).IsChannel Then chatType = "channel"
                        End If
                    End If
                End If
            End If

            ' Save updated peers to disk asynchronously
            SavePeerCacheToDiskDeferred()

            If chatType <> "private" AndAlso fromId <> 0 AndAlso tgUserUpdateMgr IsNot Nothing _
                    AndAlso tgUserUpdateMgr.Users.ContainsKey(fromId) Then
                Dim s As TL.User = tgUserUpdateMgr.Users(fromId)
                handle = NormalizeHandle(s.username)
            End If

            If String.IsNullOrEmpty(convName) Then convName = chatId.ToString()

            Dim text As String = If(newMsg.message, "")
            Dim mediaType As String = ""
            Dim fileName As String = ""
            Dim fileSize As Long = 0
            Dim mediaUrl As String = ""
            Dim mediaPending As Boolean = False
            Dim mediaError As String = ""
            Dim uidStr As String = "tgu:" & chatId.ToString() & ":" & msgId.ToString()
            ' A catch-up re-reads recent history; anything already posted
            ' live is skipped so it isn't shown or answered twice.
            If Not _seenTgUserInbound.TryAdd(uidStr, 0) Then Return
            If _seenTgUserInbound.Count > 20000 Then _seenTgUserInbound.Clear()
            If newMsg.media IsNot Nothing Then
                Dim info = DescribeUserApiMedia(newMsg.media)
                mediaType = info.kind
                fileName = info.name
                fileSize = info.size
                If String.IsNullOrEmpty(text) Then
                    Select Case mediaType
                        Case "photo" : text = "[Photo]"
                        Case "" : text = ""
                        Case "media" : text = "[Media]"
                        Case Else : text = "[" & Char.ToUpper(mediaType(0)) & mediaType.Substring(1) & "]"
                    End Select
                End If
                If info.downloadable Then
                    If info.size > MEDIA_MAX_BYTES Then
                        mediaError = "File is larger than " & (MEDIA_MAX_BYTES \ (1024L * 1024L)).ToString() & " MB — open it in Telegram."
                    ElseIf info.size <= MEDIA_INLINE_AWAIT_MAX Then
                        ' Awaited inline: the message arrives complete, and
                        ' the URL is saved with the row in one write.
                        mediaUrl = Await DownloadUserApiMediaAsync(newMsg.media, fileName)
                        If mediaUrl = "" Then mediaError = "Download failed — open it in Telegram."
                    Else
                        mediaPending = True
                    End If
                End If
            End If
            If String.IsNullOrEmpty(text) Then text = "[Empty message]"

            ' ── Reply detection ─────────────────────────────────────────
            ' reply_to is a MessageReplyHeader (or a story reply header).
            ' Read by name: its members have moved between TL layers.
            Dim replyToId As String = ""
            Dim replyQuote As String = ""
            Try
                If newMsg.reply_to IsNot Nothing Then
                    Dim rid As Long = ReadLong(newMsg.reply_to, "reply_to_msg_id")
                    ' A reply to a message in ANOTHER chat carries its peer;
                    ' that id means nothing in this conversation.
                    Dim otherPeer As Object = ReadMember(newMsg.reply_to, "reply_to_peer_id")
                    If rid > 0 AndAlso otherPeer Is Nothing Then replyToId = rid.ToString()
                    replyQuote = ReadStr(newMsg.reply_to, "quote_text")
                End If
            Catch
            End Try

            ' Mention / reply detection
            Dim mentioned As Boolean = False
            Dim replyToBot As Boolean = False
            Try
                If newMsg.entities IsNot Nothing AndAlso newMsg.entities.Length > 0 Then
                    Dim uname As String = If(tgUserSelfUsername, "").TrimStart("@"c)
                    For Each ent In newMsg.entities
                        If ent Is Nothing Then Continue For
                        If TypeOf ent Is TL.MessageEntityMentionName Then
                            Dim mn As TL.MessageEntityMentionName = CType(ent, TL.MessageEntityMentionName)
                            If tgUserSelfId <> 0 AndAlso mn.user_id = tgUserSelfId Then
                                mentioned = True : Exit For
                            End If
                        ElseIf TypeOf ent Is TL.MessageEntityMention Then
                            Dim eOff As Integer = ReadIntFieldOrProperty(ent, "offset")
                            Dim eLen As Integer = ReadIntFieldOrProperty(ent, "length")
                            If Not String.IsNullOrEmpty(uname) AndAlso eOff >= 0 _
                                    AndAlso (eOff + eLen) <= text.Length Then
                                Dim slice As String = text.Substring(eOff, eLen).TrimStart("@"c)
                                If String.Equals(slice, uname, StringComparison.OrdinalIgnoreCase) Then
                                    mentioned = True : Exit For
                                End If
                            End If
                        End If
                    Next
                End If
                If newMsg.reply_to IsNot Nothing AndAlso chatType = "private" Then
                    replyToBot = True
                End If
            Catch
            End Try

            Dim msgTime As DateTime
            Try
                msgTime = msgBase.Date.ToLocalTime()
            Catch
                msgTime = DateTime.Now
            End Try

            PostToJS("newMessage", New With {
                .platform = "telegram",
                .id = msgId,
                .uid = uidStr,
                .chatId = chatId.ToString(),
                .chatType = chatType,
                .name = convName,
                .handle = handle,
                .avatar = "",
                .bio = "",
                .coverUrl = "",
                .text = text,
                .mediaType = mediaType,
                .mediaUrl = mediaUrl,
                .fileName = fileName,
                .fileSize = fileSize,
                .mediaPending = mediaPending,
                .mediaError = mediaError,
                .replyToId = replyToId,
                .replyText = replyQuote,
                .via = "user",
                .mentioned = mentioned,
                .replyToBot = replyToBot,
                .t = msgTime.ToString("HH:mm")
            })

            If mediaPending Then
                Dim snapMedia As TL.MessageMedia = newMsg.media
                Dim snapName As String = fileName
                DownloadInBackground("telegram", chatId.ToString(), msgId.ToString(), uidStr, mediaType, fileName,
                                     Function() DownloadUserApiMediaAsync(snapMedia, snapName))
            End If

            ' Async profile backfill for private chats
            If chatType = "private" AndAlso chatId <> 0 Then
                Dim snapChatId As Long = chatId
                Task.Run(Async Function()
                             Try
                                 Dim cacheKey As String = "tg-user:" & snapChatId.ToString()
                                 Dim cached = ProfileCacheGet(cacheKey)
                                 Dim fetchedAvatar As String = ""
                                 Dim fetchedBio As String = ""
                                 If cached IsNot Nothing Then
                                     fetchedAvatar = cached.Avatar
                                     fetchedBio = cached.Bio
                                 Else
                                     fetchedAvatar = Await TryGetUserApiAvatarDataUri(snapChatId)
                                     Try
                                         If tgUserUpdateMgr IsNot Nothing AndAlso tgUserUpdateMgr.Users.ContainsKey(snapChatId) Then
                                             Dim uPeer As TL.InputPeer = tgUserUpdateMgr.Users(snapChatId)
                                             Dim uPeerUser As TL.InputPeerUser = TryCast(uPeer, TL.InputPeerUser)
                                             If uPeerUser IsNot Nothing Then
                                                 Dim inputUser As New TL.InputUser(uPeerUser.user_id, uPeerUser.access_hash)
                                                 Dim fullInfo = Await tgUserClient.Users_GetFullUser(inputUser)
                                                 If fullInfo IsNot Nothing AndAlso fullInfo.full_user IsNot Nothing Then
                                                     Dim aboutText As String = fullInfo.full_user.about
                                                     If Not String.IsNullOrEmpty(aboutText) Then fetchedBio = aboutText
                                                 End If
                                             End If
                                         End If
                                     Catch
                                     End Try
                                     ProfileCacheSet(cacheKey, fetchedAvatar, fetchedBio, "")
                                 End If
                                 If Not String.IsNullOrEmpty(fetchedAvatar) OrElse Not String.IsNullOrEmpty(fetchedBio) Then
                                     PostToJS("userProfileUpdate", New With {
                                         .platform = "telegram",
                                         .chatId = snapChatId.ToString(),
                                         .avatar = fetchedAvatar,
                                         .bio = fetchedBio,
                                         .coverUrl = ""
                                     })
                                 End If
                             Catch
                             End Try
                         End Function)
            End If
        Catch ex As Exception
            PostToJS("telegramError", New With {.error = "User update handler: " & ex.Message})
        End Try
        Await Task.CompletedTask
    End Function


#End Region

#Region "Telegram Bot API (inbound + send)"

    Private Async Function OnTelegramUpdate(
            bot As ITelegramBotClient,
            update As Telegram.Bot.Types.Update,
            ct As CancellationToken) As Task
        Try
            ' ── Edits ───────────────────────────────────────────────────
            ' The Bot API delivers edits (edited_message). It never delivers
            ' deletions — Telegram does not tell bots when a message is
            ' deleted, so that part is User API / Discord only.
            If update.EditedMessage IsNot Nothing Then
                Dim em As Telegram.Bot.Types.Message = update.EditedMessage
                Dim emChat As String = em.Chat.Id.ToString()
                PostToJS("messageEdited", New With {
                    .platform = "telegram", .chatId = emChat,
                    .messageId = em.MessageId.ToString(),
                    .uid = "tg:" & emChat & ":" & em.MessageId.ToString(),
                    .text = If(em.Text, If(em.Caption, "")),
                    .isOut = False, .via = "bot"
                })
                Return
            End If
            If update.Message Is Nothing Then Return
            Dim msg As Telegram.Bot.Types.Message = update.Message
            If IsTelegramServiceMessage(msg) Then Return

            Dim fromId As Long = If(msg.From IsNot Nothing, msg.From.Id, 0L)
            Dim chatIdLong As Long = msg.Chat.Id
            Dim chatType As String = msg.Chat.Type.ToString().ToLowerInvariant()
            If chatType = "supergroup" OrElse chatType = "channel" Then chatType = "group"

            Dim isGroup As Boolean = chatType = "group"
            Dim botShouldRespond As Boolean = True
            If isGroup Then
                If Not TelegramMentionsBot(msg.Text, msg.Entities, tgBotUsername, tgBotId) AndAlso
                   Not TelegramMentionsBot(msg.Caption, msg.CaptionEntities, tgBotUsername, tgBotId) Then
                    botShouldRespond = False
                End If
            End If

            Dim convName As String = ""
            Dim handle As String = ""
            If isGroup Then
                convName = If(msg.Chat.Title, chatIdLong.ToString())
                If msg.From IsNot Nothing Then
                    handle = NormalizeHandle(msg.From.Username)
                End If
            Else
                If msg.From IsNot Nothing Then
                    convName = (If(msg.From.FirstName, "") & " " & If(msg.From.LastName, "")).Trim()
                    If String.IsNullOrEmpty(convName) Then convName = If(msg.From.Username, fromId.ToString())
                    handle = NormalizeHandle(msg.From.Username)
                End If
            End If

            Dim mentioned As Boolean = False
            Dim replyToBot As Boolean = False
            If isGroup Then
                mentioned = TelegramMentionsBot(msg.Text, msg.Entities, tgBotUsername, tgBotId) OrElse
                            TelegramMentionsBot(msg.Caption, msg.CaptionEntities, tgBotUsername, tgBotId)
                If msg.ReplyToMessage IsNot Nothing AndAlso
                   msg.ReplyToMessage.From IsNot Nothing AndAlso
                   tgBotId <> 0 AndAlso msg.ReplyToMessage.From.Id = tgBotId Then
                    replyToBot = True
                End If
            End If

            ' Snapshot for closure captures
            Dim snapBot As TelegramBotClient = tgBotClient
            Dim snapToken As String = tgToken
            Dim snapFromId As Long = fromId
            Dim snapChatId As Long = chatIdLong
            Dim snapPlatform As String = "telegram"
            Dim snapChatType As String = chatType

            Dim content = ExtractTelegramContent(msg)
            Dim snapMsgId As Integer = msg.MessageId
            Dim snapUid As String = "tg:" & snapChatId.ToString() & ":" & snapMsgId.ToString()
            Dim mediaUrl As String = ""
            Dim mediaPending As Boolean = False
            Dim mediaError As String = ""
            If Not String.IsNullOrEmpty(content.fileId) Then
                If content.fileSize > TG_BOT_FILE_MAX Then
                    mediaError = "Telegram bots can't download files over 20 MB — open it in Telegram."
                ElseIf content.fileSize > 0 AndAlso content.fileSize > MEDIA_INLINE_AWAIT_MAX Then
                    mediaPending = True
                Else
                    Try
                        mediaUrl = Await DownloadBotFileAsync(snapBot, snapToken, content.fileId, content.mime, content.fileName)
                    Catch ex As Exception
                        mediaError = "Download failed: " & ex.Message
                    End Try
                    If mediaUrl = "" AndAlso mediaError = "" Then mediaError = "Download failed — open it in Telegram."
                End If
            End If

            ' Reply detection — the Bot API hands us the quoted message.
            Dim replyToId As String = ""
            Dim replyText As String = ""
            Dim replyFromSelf As Boolean = False
            If msg.ReplyToMessage IsNot Nothing Then
                replyToId = msg.ReplyToMessage.MessageId.ToString()
                replyText = If(msg.ReplyToMessage.Text, If(msg.ReplyToMessage.Caption, ""))
                replyFromSelf = msg.ReplyToMessage.From IsNot Nothing AndAlso tgBotId <> 0 AndAlso msg.ReplyToMessage.From.Id = tgBotId
            End If

            Dim avatarCacheKey As String = "tg-bot-avatar:" & snapFromId.ToString()
            Dim chatCacheKey As String = "tg-bot-chat:" & snapChatId.ToString()
            Dim cachedAvatar = ProfileCacheGet(avatarCacheKey)
            Dim cachedChat = ProfileCacheGet(chatCacheKey)

            PostToJS("newMessage", New With {
                .platform = snapPlatform,
                .id = snapMsgId.ToString(),
                .uid = snapUid,
                .chatId = snapChatId.ToString(),
                .chatType = snapChatType,
                .name = convName,
                .handle = handle,
                .avatar = If(cachedAvatar IsNot Nothing, cachedAvatar.Avatar, ""),
                .bio = If(cachedChat IsNot Nothing, cachedChat.Bio, ""),
                .coverUrl = If(cachedChat IsNot Nothing, cachedChat.CoverUrl, ""),
                .text = content.text,
                .mediaType = content.mediaType,
                .mediaUrl = mediaUrl,
                .fileName = content.fileName,
                .fileSize = content.fileSize,
                .mediaPending = mediaPending,
                .mediaError = mediaError,
                .replyToId = replyToId,
                .replyText = replyText,
                .replyFromSelf = replyFromSelf,
                .via = "bot",
                .mentioned = mentioned,
                .replyToBot = replyToBot,
                .t = msg.Date.ToLocalTime().ToString("HH:mm"),
                .botShouldRespond = botShouldRespond
            })

            If mediaPending Then
                Dim fid As String = content.fileId, fmime As String = content.mime, fname As String = content.fileName
                DownloadInBackground("telegram", snapChatId.ToString(), snapMsgId.ToString(), snapUid, content.mediaType, fname,
                                     Function() DownloadBotFileAsync(snapBot, snapToken, fid, fmime, fname))
            End If

            ' Async profile + media URL backfill
            Task.Run(Async Function()
                         Try
                             Dim fetchedAvatar As String = ""
                             Dim fetchedBio As String = ""
                             Dim fetchedCover As String = ""

                             If cachedAvatar IsNot Nothing Then
                                 fetchedAvatar = cachedAvatar.Avatar
                             End If
                             If cachedChat IsNot Nothing Then
                                 fetchedBio = cachedChat.Bio
                                 fetchedCover = cachedChat.CoverUrl
                             End If

                             Try
                                 If snapFromId <> 0 AndAlso cachedAvatar Is Nothing Then
                                     fetchedAvatar = Await TryGetTelegramAvatarUrl(snapBot, snapFromId, snapToken)
                                     ProfileCacheSet(avatarCacheKey, fetchedAvatar, "", "")
                                 End If
                             Catch
                             End Try
                             Try
                                 If snapChatType = "private" AndAlso cachedChat Is Nothing Then
                                     Dim meta = Await TryGetTelegramChatMeta(snapBot, snapChatId, snapToken)
                                     fetchedBio = meta.bio
                                     fetchedCover = meta.coverUrl
                                     ProfileCacheSet(chatCacheKey, "", fetchedBio, fetchedCover)
                                 End If
                             Catch
                             End Try

                             If Not String.IsNullOrEmpty(fetchedAvatar) _
                                     OrElse Not String.IsNullOrEmpty(fetchedBio) _
                                     OrElse Not String.IsNullOrEmpty(fetchedCover) Then
                                 PostToJS("userProfileUpdate", New With {
                                     .platform = snapPlatform,
                                     .chatId = snapChatId.ToString(),
                                     .messageId = snapMsgId,
                                     .avatar = fetchedAvatar,
                                     .bio = fetchedBio,
                                     .coverUrl = fetchedCover
                                 })
                             End If
                         Catch
                         End Try
                     End Function)
        Catch ex As Exception
            PostToJS("telegramError", New With {.error = "Update handler: " & ex.Message})
        End Try
    End Function

    Private Function OnTelegramError(bot As ITelegramBotClient, ex As Exception, ct As CancellationToken) As Task
        PostToJS("telegramError", New With {.error = ex.Message})
        PostToJS("platformLog", New With {.platform = "telegram", .level = "error", .msg = "Bot API polling error: " & ex.Message})
        Return Task.CompletedTask
    End Function


    Private Sub DisconnectTelegram()
        Try
            ' Signal the supervised polling loop that this teardown is
            ' deliberate so it exits instead of trying to auto-reconnect.
            _tgBotIntentionalDisconnect = True
            If tgCts IsNot Nothing Then
                Try : tgCts.Cancel() : Catch : End Try
                Try : tgCts.Dispose() : Catch : End Try
                tgCts = Nothing
            End If
            tgBotClient = Nothing
            tgConnected = False
            tgBotId = 0
            tgBotUsername = ""
            tgToken = ""
            DisconnectTelegramUser()
            PostToJS("telegramStatus", New With {.connected = False, .error = ""})
        Catch
        End Try
    End Sub

    Private Async Function TryGetTelegramAvatarUrl(client As ITelegramBotClient, userId As Long, token As String) As Task(Of String)
        Try
            Dim photos = Await client.GetUserProfilePhotosAsync(userId, 0, 1)
            If photos Is Nothing OrElse photos.TotalCount = 0 OrElse photos.Photos Is Nothing OrElse photos.Photos.Length = 0 Then Return ""
            Dim sizes = photos.Photos(0)
            If sizes Is Nothing OrElse sizes.Length = 0 Then Return ""
            Dim photo = sizes(sizes.Length - 1)
            Dim file = Await client.GetFileAsync(photo.FileId)
            If file Is Nothing OrElse String.IsNullOrEmpty(file.FilePath) Then Return ""
            Return "https://api.telegram.org/file/bot" & token & "/" & file.FilePath
        Catch
            Return ""
        End Try
    End Function

    Private Async Function TryGetTelegramChatMeta(client As ITelegramBotClient, chatId As Long, token As String) As Task(Of (bio As String, coverUrl As String))
        Try
            Dim chat = Await client.GetChatAsync(chatId)
            If chat Is Nothing Then Return ("", "")
            Dim bio As String = If(chat.Bio, "")
            Dim coverUrl As String = ""
            If chat.Photo IsNot Nothing AndAlso Not String.IsNullOrEmpty(chat.Photo.BigFileId) Then
                Try
                    Dim file = Await client.GetFileAsync(chat.Photo.BigFileId)
                    If file IsNot Nothing AndAlso Not String.IsNullOrEmpty(file.FilePath) Then
                        coverUrl = "https://api.telegram.org/file/bot" & token & "/" & file.FilePath
                    End If
                Catch
                End Try
            End If
            Return (bio, coverUrl)
        Catch
            Return ("", "")
        End Try
    End Function

    ' What a Bot API message carries. Files are no longer resolved to an
    ' api.telegram.org link here: that link embeds the bot token (it was
    ' being written into the database) and expires after about an hour, so
    ' a document opened later simply failed. The file is downloaded instead
    ' — see DownloadBotFileAsync.
    Private Function ExtractTelegramContent(msg As Telegram.Bot.Types.Message) _
            As (text As String, mediaType As String, fileId As String, fileName As String, fileSize As Long, mime As String)
        If Not String.IsNullOrEmpty(msg.Text) Then Return (msg.Text, "", "", "", 0L, "")
        Dim caption As String = If(msg.Caption, "")
        Dim mediaType As String = ""
        Dim fobj As Object = Nothing
        Dim mime As String = ""
        If msg.Photo IsNot Nothing AndAlso msg.Photo.Length > 0 Then
            mediaType = "photo" : fobj = msg.Photo(msg.Photo.Length - 1) : mime = "image/jpeg"
        ElseIf msg.Voice IsNot Nothing Then
            mediaType = "voice" : fobj = msg.Voice : mime = "audio/ogg"
        ElseIf msg.Audio IsNot Nothing Then
            mediaType = "audio" : fobj = msg.Audio : mime = "audio/mpeg"
        ElseIf msg.Video IsNot Nothing Then
            mediaType = "video" : fobj = msg.Video : mime = "video/mp4"
        ElseIf msg.VideoNote IsNot Nothing Then
            mediaType = "video" : fobj = msg.VideoNote : mime = "video/mp4"
        ElseIf msg.Animation IsNot Nothing Then
            mediaType = "gif" : fobj = msg.Animation : mime = "video/mp4"
        ElseIf msg.Document IsNot Nothing Then
            mediaType = "document" : fobj = msg.Document : mime = "application/octet-stream"
        ElseIf msg.Sticker IsNot Nothing Then
            fobj = msg.Sticker
            Dim isAnimated As Boolean = False, isVideo As Boolean = False
            Try : isAnimated = CBool(If(ReadMember(msg.Sticker, "IsAnimated"), False)) : Catch : End Try
            Try : isVideo = CBool(If(ReadMember(msg.Sticker, "IsVideo"), False)) : Catch : End Try
            If isVideo Then
                mediaType = "video" : mime = "video/webm"
            ElseIf isAnimated Then
                mediaType = "document" : mime = "application/x-tgsticker"
            Else
                mediaType = "sticker" : mime = "image/webp"
            End If
        ElseIf msg.Location IsNot Nothing Then
            Return ("[Location] " & msg.Location.Latitude.ToString() & ", " & msg.Location.Longitude.ToString(), "location", "", "", 0L, "")
        ElseIf msg.Contact IsNot Nothing Then
            Return ("[Contact] " & If(msg.Contact.FirstName, "") & " " & If(msg.Contact.PhoneNumber, ""), "contact", "", "", 0L, "")
        ElseIf msg.Poll IsNot Nothing Then
            Return ("[Poll] " & If(msg.Poll.Question, ""), "poll", "", "", 0L, "")
        Else
            Return ("[Unsupported message type]", "unsupported", "", "", 0L, "")
        End If
        Dim fileId As String = ReadStr(fobj, "FileId")
        Dim fileName As String = ReadStr(fobj, "FileName")
        Dim fileSize As Long = ReadLong(fobj, "FileSize")
        Dim realMime As String = ReadStr(fobj, "MimeType")
        If realMime <> "" Then mime = realMime
        If mediaType = "document" AndAlso mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase) Then mediaType = "photo"
        If fileName = "" AndAlso mediaType = "document" Then fileName = If(mime = "application/x-tgsticker", "sticker.tgs", "file" & ExtForMime(mime))
        Dim label As String = "[" & Char.ToUpper(mediaType(0)) & mediaType.Substring(1) & "]"
        Return (If(String.IsNullOrEmpty(caption), label, label & " " & caption), mediaType, fileId, fileName, fileSize, mime)
    End Function

    ' Telegram's Bot API serves files of at most 20 MB.
    Private Const TG_BOT_FILE_MAX As Long = 20L * 1024L * 1024L

    Private Async Function DownloadBotFileAsync(client As ITelegramBotClient, token As String, fileId As String,
                                                mime As String, fileName As String) As Task(Of String)
        If client Is Nothing OrElse String.IsNullOrEmpty(fileId) Then Return ""
        Dim f = Await client.GetFileAsync(fileId)
        If f Is Nothing OrElse String.IsNullOrEmpty(f.FilePath) Then Return ""
        Dim bytes As Byte() = Await HttpBig.GetByteArrayAsync("https://api.telegram.org/file/bot" & token & "/" & f.FilePath)
        Return StoreInboundMedia(bytes, mime, fileName)
    End Function

    Private Function IsTelegramServiceMessage(msg As Telegram.Bot.Types.Message) As Boolean
        If msg Is Nothing Then Return False
        If Not String.IsNullOrEmpty(msg.Text) Then Return False
        If Not String.IsNullOrEmpty(msg.Caption) Then Return False
        If msg.Photo IsNot Nothing AndAlso msg.Photo.Length > 0 Then Return False
        If msg.Video IsNot Nothing OrElse msg.VideoNote IsNot Nothing Then Return False
        If msg.Audio IsNot Nothing OrElse msg.Voice IsNot Nothing Then Return False
        If msg.Document IsNot Nothing OrElse msg.Animation IsNot Nothing Then Return False
        If msg.Sticker IsNot Nothing Then Return False
        If msg.Location IsNot Nothing Then Return False
        If msg.Contact IsNot Nothing Then Return False
        If msg.Poll IsNot Nothing Then Return False
        If msg.Dice IsNot Nothing Then Return False
        Dim t = msg.GetType()
        For Each propName In New String() {
                "NewChatMembers", "LeftChatMember", "NewChatTitle",
                "NewChatPhoto", "DeleteChatPhoto", "GroupChatCreated",
                "SupergroupChatCreated", "ChannelChatCreated",
                "MigrateToChatId", "MigrateFromChatId", "PinnedMessage",
                "MessageAutoDeleteTimerChanged",
                "VideoChatScheduled", "VideoChatStarted", "VideoChatEnded",
                "VideoChatParticipantsInvited", "WebAppData",
                "UsersShared", "ChatShared", "ProximityAlertTriggered",
                "ForumTopicCreated", "ForumTopicEdited", "ForumTopicClosed",
                "ForumTopicReopened", "GeneralForumTopicHidden",
                "GeneralForumTopicUnhidden", "WriteAccessAllowed",
                "Story", "BoostAdded", "ChatBackgroundSet"}
            Try
                Dim p = t.GetProperty(propName)
                If p IsNot Nothing AndAlso p.GetValue(msg, Nothing) IsNot Nothing Then Return True
            Catch
            End Try
        Next
        Return True
    End Function

    Private Function TelegramMentionsBot(text As String, entities As Telegram.Bot.Types.MessageEntity(), botUsername As String, botUserId As Long) As Boolean
        If String.IsNullOrEmpty(text) OrElse entities Is Nothing OrElse entities.Length = 0 Then Return False
        Dim uname As String = If(botUsername, "").TrimStart("@"c)
        For Each ent As Telegram.Bot.Types.MessageEntity In entities
            If ent Is Nothing Then Continue For
            Try
                Select Case ent.Type
                    Case Telegram.Bot.Types.Enums.MessageEntityType.Mention
                        If Not String.IsNullOrEmpty(uname) AndAlso ent.Offset >= 0 AndAlso (ent.Offset + ent.Length) <= text.Length Then
                            Dim slice As String = text.Substring(ent.Offset, ent.Length).TrimStart("@"c)
                            If String.Equals(slice, uname, StringComparison.OrdinalIgnoreCase) Then Return True
                        End If
                    Case Telegram.Bot.Types.Enums.MessageEntityType.TextMention
                        If ent.User IsNot Nothing AndAlso botUserId <> 0 AndAlso ent.User.Id = botUserId Then Return True
                End Select
            Catch
            End Try
        Next
        Return False
    End Function

    Private Function ReadIntFieldOrProperty(obj As Object, memberName As String) As Integer
        If obj Is Nothing OrElse String.IsNullOrEmpty(memberName) Then Return 0
        Try
            Dim t = obj.GetType()
            Dim flags = System.Reflection.BindingFlags.Public Or System.Reflection.BindingFlags.NonPublic Or
                        System.Reflection.BindingFlags.Instance Or System.Reflection.BindingFlags.IgnoreCase
            Dim f = t.GetField(memberName, flags)
            If f IsNot Nothing Then
                Dim v = f.GetValue(obj)
                If v IsNot Nothing Then Return Convert.ToInt32(v)
            End If
            Dim p = t.GetProperty(memberName, flags)
            If p IsNot Nothing AndAlso p.CanRead Then
                Dim v = p.GetValue(obj, Nothing)
                If v IsNot Nothing Then Return Convert.ToInt32(v)
            End If
        Catch
        End Try
        Return 0
    End Function

#End Region

#Region "Discord"

    ' ── ConnectDiscord ───────────────────────────────────────────────
    ' Creates a fresh DiscordSocketClient, registers handlers, and logs in.
    ' Discord.NET's internal reconnect handles the vast majority of transient
    ' gateway drops — we don't fight it by re-creating the client on every
    ' Disconnected event. Instead we arm a single 90-second last-resort watchdog
    ' that fires only if Discord.NET completely gives up.
    Private Async Function ConnectDiscord(token As String) As Task
        If String.IsNullOrWhiteSpace(token) Then
            PostToJS("discordStatus", New With {.connected = False, .error = "Token is empty."})
            Return
        End If
        Try
            ' Arm the watchdog before tearing down the old client so the
            ' cancellation token reference is fresh.
            CancelDiscordWatchdog()
            Await DisconnectDiscord()

            dcToken = token
            _dcDmCache.Clear()

            ' DirectMessageTyping / GuildMessageTyping: needed for the
            ' UserIsTyping event that drives the contact-list typing
            ' indicator. Neither is a privileged intent.
            Dim config As New DiscordSocketConfig With {
                .GatewayIntents = GatewayIntents.Guilds Or
                                  GatewayIntents.GuildMessages Or
                                  GatewayIntents.DirectMessages Or
                                  GatewayIntents.MessageContent Or
                                  GatewayIntents.GuildMembers Or
                                  GatewayIntents.DirectMessageTyping Or
                                  GatewayIntents.GuildMessageTyping,
                .MessageCacheSize = 100,
                .AlwaysDownloadUsers = True
            }
            dcClient = New DiscordSocketClient(config)
            AddHandler dcClient.MessageReceived, AddressOf OnDiscordMessage
            AddHandler dcClient.Ready, AddressOf OnDiscordReady
            AddHandler dcClient.Disconnected, AddressOf OnDiscordDisconnected
            AddHandler dcClient.LoggedOut, AddressOf OnDiscordLoggedOut
            AddHandler dcClient.UserIsTyping, AddressOf OnDiscordUserTyping
            AddHandler dcClient.MessageUpdated, AddressOf OnDiscordMessageUpdated
            AddHandler dcClient.MessageDeleted, AddressOf OnDiscordMessageDeleted
            AddHandler dcClient.MessagesBulkDeleted, AddressOf OnDiscordMessagesBulkDeleted

            Await dcClient.LoginAsync(TokenType.Bot, token)
            Await dcClient.StartAsync()

            PostToJS("platformLog", New With {.platform = "discord", .level = "info", .msg = "Logging in…"})
        Catch ex As Exception
            dcConnected = False
            PostToJS("discordStatus", New With {.connected = False, .error = ex.Message})
            PostToJS("platformLog", New With {.platform = "discord", .level = "error", .msg = "Connect failed: " & ex.Message})
        End Try
    End Function

    Private Async Function DisconnectDiscord() As Task
        Try
            ' Intentional disconnect — clear the token so the watchdog doesn't retry.
            dcToken = ""
            CancelDiscordWatchdog()
            If dcClient IsNot Nothing Then
                Try
                    RemoveHandler dcClient.MessageReceived, AddressOf OnDiscordMessage
                    RemoveHandler dcClient.Ready, AddressOf OnDiscordReady
                    RemoveHandler dcClient.Disconnected, AddressOf OnDiscordDisconnected
                    RemoveHandler dcClient.LoggedOut, AddressOf OnDiscordLoggedOut
                    RemoveHandler dcClient.UserIsTyping, AddressOf OnDiscordUserTyping
                    RemoveHandler dcClient.MessageUpdated, AddressOf OnDiscordMessageUpdated
                    RemoveHandler dcClient.MessageDeleted, AddressOf OnDiscordMessageDeleted
                    RemoveHandler dcClient.MessagesBulkDeleted, AddressOf OnDiscordMessagesBulkDeleted
                Catch
                End Try
                Try : Await dcClient.StopAsync() : Catch : End Try
                Try : Await dcClient.LogoutAsync() : Catch : End Try
                Try : dcClient.Dispose() : Catch : End Try
                dcClient = Nothing
            End If
            dcConnected = False
            dcSelfId = 0
            _dcDmCache.Clear()
        Catch
        End Try
    End Function

    Private Function OnDiscordReady() As Task
        dcConnected = True
        Interlocked.Exchange(_dcWatchdogFired, 0)   ' re-arm watchdog for next disconnect
        CancelDiscordWatchdog()                      ' cancel any pending watchdog — we're connected
        Dim self As SocketSelfUser = Nothing
        If dcClient IsNot Nothing Then self = dcClient.CurrentUser
        If self IsNot Nothing Then dcSelfId = self.Id
        Dim avatar As String = ""
        Try
            If self IsNot Nothing Then
                avatar = If(self.GetAvatarUrl(ImageFormat.Auto, 256), self.GetDefaultAvatarUrl())
            End If
        Catch
        End Try
        PostToJS("discordStatus", New With {
            .connected = True,
            .botName = If(self IsNot Nothing, self.Username, ""),
            .username = If(self IsNot Nothing, self.Username, ""),
            .botId = If(self IsNot Nothing, self.Id.ToString(), ""),
            .avatar = avatar
        })
        PostToJS("platformLog", New With {.platform = "discord", .level = "ok", .msg = "Connected as " & If(self IsNot Nothing, self.Username, "?")})
        Return Task.CompletedTask
    End Function

    ' Discord.NET handles its own reconnect for virtually all gateway drops.
    ' We only arm a single "last-resort" watchdog to fire once after 90 s
    ' if dcConnected is still False — this catches the rare case where
    ' Discord.NET's reconnect loop has genuinely given up (hard 4014 etc).
    ' Intentional disconnects (dcToken cleared) suppress the watchdog.
    '
    ' The page is told this is a drop Discord.NET is retrying itself
    ' (reconnecting = True), so its own supervisor waits instead of
    ' tearing the client down mid-resume.
    Private Function OnDiscordDisconnected(ex As Exception) As Task
        dcConnected = False
        Dim retrying As Boolean = Not String.IsNullOrEmpty(dcToken)
        PostToJS("discordStatus", New With {
            .connected = False,
            .reconnecting = retrying,
            .error = If(ex IsNot Nothing, ex.Message, "Disconnected")
        })
        PostToJS("platformLog", New With {.platform = "discord", .level = "warn", .msg = "Disconnected: " & If(ex IsNot Nothing, ex.Message, "gateway closed")})

        ' Only arm if: operator hasn't disconnected, watchdog not already fired.
        If Not String.IsNullOrEmpty(dcToken) AndAlso
           Interlocked.CompareExchange(_dcWatchdogFired, 1, 0) = 0 Then
            ArmDiscordWatchdog(dcToken)
        End If
        Return Task.CompletedTask
    End Function

    Private Sub ArmDiscordWatchdog(retryToken As String)
        CancelDiscordWatchdog()
        _dcWatchdogCts = New CancellationTokenSource()
        Dim cts As CancellationTokenSource = _dcWatchdogCts
        Task.Run(Async Function()
                     Try
                         PostToJS("platformLog", New With {.platform = "discord", .level = "info", .msg = "Watchdog armed — will retry if not reconnected in 90s"})
                         Await Task.Delay(90_000, cts.Token)
                         If cts.IsCancellationRequested Then Return
                         If dcConnected Then Return       ' Discord.NET reconnected on its own
                         If String.IsNullOrEmpty(dcToken) Then Return  ' operator disconnected
                         PostToJS("platformLog", New With {.platform = "discord", .level = "warn", .msg = "Watchdog triggered — forcing reconnect"})
                         Await ConnectDiscord(retryToken)
                     Catch
                     End Try
                 End Function)
    End Sub

    Private Sub CancelDiscordWatchdog()
        Try
            If _dcWatchdogCts IsNot Nothing Then
                _dcWatchdogCts.Cancel()
                _dcWatchdogCts.Dispose()
                _dcWatchdogCts = Nothing
            End If
        Catch
        End Try
    End Sub

    Private Function OnDiscordLoggedOut() As Task
        dcConnected = False
        dcToken = ""      ' prevent watchdog retry on intentional logout
        CancelDiscordWatchdog()
        Interlocked.Exchange(_dcWatchdogFired, 0)
        PostToJS("platformLog", New With {.platform = "discord", .level = "info", .msg = "Logged out"})
        Return Task.CompletedTask
    End Function

    ' ── Discord typing ───────────────────────────────────────────────
    ' Discord shows typing for ~10 s per event and sends no "stopped"
    ' event; the contact list also ends it the moment their message lands.
    ' chatId is the channel id — the same id newMessage uses.
    Private Function OnDiscordUserTyping(user As Cacheable(Of IUser, ULong),
                                         channel As Cacheable(Of IMessageChannel, ULong)) As Task
        Try
            Dim uid As ULong = user.Id
            If uid = 0 OrElse (dcSelfId <> 0 AndAlso uid = dcSelfId) Then Return Task.CompletedTask
            If user.HasValue AndAlso user.Value IsNot Nothing AndAlso user.Value.IsBot Then Return Task.CompletedTask
            If channel.Id = 0 Then Return Task.CompletedTask
            PostToJS("userTyping", New With {.platform = "discord", .chatId = channel.Id.ToString(), .ms = 10000, .action = "typing"})
        Catch
        End Try
        Return Task.CompletedTask
    End Function

    ' Text, embed and sticker content of a Discord message. Attachments are
    ' handled separately (DiscordAttachmentKind / DownloadDiscordAttachment):
    ' every attachment is kept, not only the first, and each is downloaded
    ' because Discord's CDN links are signed and stop working after ~24h.
    Private Function ExtractDiscordContent(rawMsg As SocketMessage) As (text As String, mediaType As String, mediaUrl As String)
        Dim text As String = If(rawMsg.Content, "")
        Dim mediaType As String = ""
        Dim mediaUrl As String = ""
        If rawMsg.Attachments IsNot Nothing AndAlso rawMsg.Attachments.Count > 0 Then
            Return (text, "", "")
        ElseIf rawMsg.Embeds IsNot Nothing AndAlso rawMsg.Embeds.Count > 0 Then
            Dim emb = rawMsg.Embeds.First()
            mediaType = "embed"
            If emb IsNot Nothing AndAlso emb.Image.HasValue Then mediaUrl = emb.Image.Value.Url : mediaType = "photo"
            If String.IsNullOrEmpty(text) Then
                text = If(emb IsNot Nothing AndAlso Not String.IsNullOrEmpty(emb.Title), "[Embed] " & emb.Title, "[Embed]")
            End If
        ElseIf rawMsg.Stickers IsNot Nothing AndAlso rawMsg.Stickers.Count > 0 Then
            mediaType = "sticker"
            text = "[Sticker] " & rawMsg.Stickers.First().Name
        ElseIf String.IsNullOrEmpty(text) Then
            text = "[Empty message]"
        End If
        Return (text, mediaType, mediaUrl)
    End Function

    Private Function DiscordAttachmentKind(att As IAttachment) As String
        Dim ct As String = If(att.ContentType, "").ToLowerInvariant()
        Dim fn As String = If(att.Filename, "").ToLowerInvariant()
        If ct.StartsWith("image/") OrElse fn.EndsWith(".png") OrElse fn.EndsWith(".jpg") OrElse fn.EndsWith(".jpeg") OrElse fn.EndsWith(".gif") OrElse fn.EndsWith(".webp") Then Return "photo"
        If ct.StartsWith("video/") OrElse fn.EndsWith(".mp4") OrElse fn.EndsWith(".webm") OrElse fn.EndsWith(".mov") Then Return "video"
        If ct.StartsWith("audio/") OrElse fn.EndsWith(".mp3") OrElse fn.EndsWith(".ogg") OrElse fn.EndsWith(".wav") Then Return "audio"
        Return "document"
    End Function

    Private Async Function DownloadDiscordAttachmentAsync(url As String, contentType As String, fileName As String) As Task(Of String)
        Dim bytes As Byte() = Await HttpBig.GetByteArrayAsync(url)
        Return StoreInboundMedia(bytes, If(String.IsNullOrEmpty(contentType), "application/octet-stream", contentType), fileName)
    End Function

    ' ── Discord edits / deletions ───────────────────────────────────
    ' MessageUpdated also fires when an embed resolves (text unchanged); the
    ' page ignores updates whose text is the same. Own messages are included
    ' so an edit the operator makes in the Discord client shows here too.
    Private Function OnDiscordMessageUpdated(before As Cacheable(Of IMessage, ULong), after As SocketMessage,
                                             channel As ISocketMessageChannel) As Task
        Try
            If after Is Nothing OrElse after.Author Is Nothing Then Return Task.CompletedTask
            Dim isOut As Boolean = dcSelfId <> 0 AndAlso after.Author.Id = dcSelfId
            If after.Author.IsBot AndAlso Not isOut Then Return Task.CompletedTask
            Dim chId As String = after.Channel.Id.ToString()
            PostToJS("messageEdited", New With {
                .platform = "discord", .chatId = chId,
                .messageId = after.Id.ToString(),
                .uid = "dc:" & chId & ":" & after.Id.ToString(),
                .text = If(after.Content, ""),
                .isOut = isOut, .via = ""
            })
        Catch ex As Exception
            PostToJS("platformLog", New With {.platform = "discord", .level = "warn", .msg = "Edit event: " & ex.Message})
        End Try
        Return Task.CompletedTask
    End Function

    Private Function OnDiscordMessageDeleted(msg As Cacheable(Of IMessage, ULong), channel As Cacheable(Of IMessageChannel, ULong)) As Task
        Try
            PostToJS("messagesDeleted", New With {
                .platform = "discord", .chatId = channel.Id.ToString(),
                .messageIds = New String() {msg.Id.ToString()}, .prefix = "dc"
            })
        Catch
        End Try
        Return Task.CompletedTask
    End Function

    Private Function OnDiscordMessagesBulkDeleted(msgs As IReadOnlyCollection(Of Cacheable(Of IMessage, ULong)),
                                                  channel As Cacheable(Of IMessageChannel, ULong)) As Task
        Try
            Dim ids As New List(Of String)
            For Each m In msgs
                ids.Add(m.Id.ToString())
            Next
            If ids.Count > 0 Then
                PostToJS("messagesDeleted", New With {
                    .platform = "discord", .chatId = channel.Id.ToString(), .messageIds = ids, .prefix = "dc"
                })
            End If
        Catch
        End Try
        Return Task.CompletedTask
    End Function

    Private Async Function OnDiscordMessage(rawMsg As SocketMessage) As Task
        Try
            If rawMsg.Author Is Nothing OrElse rawMsg.Author.IsBot Then Return
            If dcSelfId <> 0 AndAlso rawMsg.Author.Id = dcSelfId Then Return
            Try
                If rawMsg.Source <> MessageSource.User Then Return
            Catch
            End Try
            Try
                Dim mt = rawMsg.Type
                If mt <> MessageType.Default AndAlso mt <> MessageType.Reply Then Return
            Catch
            End Try

            Dim handleStr As String = NormalizeDiscordHandle(
                rawMsg.Author.Username, rawMsg.Author.Discriminator)

            Dim avatarUrl As String = ""
            Try
                avatarUrl = If(rawMsg.Author.GetAvatarUrl(ImageFormat.Auto, 256), rawMsg.Author.GetDefaultAvatarUrl())
            Catch
            End Try

            Dim chatType As String = "private"
            Dim convName As String = rawMsg.Author.Username
            Dim channelName As String = ""
            Dim guildId As String = ""
            If TypeOf rawMsg.Channel Is SocketGuildChannel Then
                Dim gc As SocketGuildChannel = CType(rawMsg.Channel, SocketGuildChannel)
                channelName = gc.Name
                guildId = gc.Guild.Id.ToString()
                chatType = "guild"
                convName = gc.Guild.Name & " · #" & gc.Name
            ElseIf TypeOf rawMsg.Channel Is SocketDMChannel Then
                chatType = "private"
                convName = rawMsg.Author.Username
            End If

            Dim content = ExtractDiscordContent(rawMsg)
            Dim chIdStr As String = rawMsg.Channel.Id.ToString()
            Dim baseUid As String = "dc:" & chIdStr & ":" & rawMsg.Id.ToString()

            Dim mentioned As Boolean = False
            Dim replyToBot As Boolean = False
            Dim replyToId As String = ""
            Dim replyText As String = ""
            Dim replyFromSelf As Boolean = False
            Try
                If dcSelfId <> 0 AndAlso rawMsg.MentionedUsers IsNot Nothing Then
                    For Each u In rawMsg.MentionedUsers
                        If u IsNot Nothing AndAlso u.Id = dcSelfId Then mentioned = True : Exit For
                    Next
                End If
                If rawMsg.Reference IsNot Nothing AndAlso rawMsg.Reference.MessageId.IsSpecified Then
                    Dim refMsgId As ULong = rawMsg.Reference.MessageId.Value
                    replyToId = refMsgId.ToString()
                    Dim refMsg As IMessage = Nothing
                    Try
                        refMsg = rawMsg.Channel.GetCachedMessage(refMsgId)
                    Catch
                    End Try
                    If refMsg Is Nothing Then
                        Try
                            refMsg = Await rawMsg.Channel.GetMessageAsync(refMsgId)
                        Catch
                        End Try
                    End If
                    If refMsg IsNot Nothing Then
                        replyText = If(refMsg.Content, "")
                        If refMsg.Author IsNot Nothing AndAlso dcSelfId <> 0 AndAlso refMsg.Author.Id = dcSelfId Then
                            replyToBot = True : replyFromSelf = True
                        End If
                    End If
                End If
            Catch
            End Try

            ' ── Attachments ───────────────────────────────────────────
            ' The first rides on the message itself; each further one is
            ' posted as its own part (same platform id, uid suffixed #n) so
            ' every file gets a bubble. A deletion removes all parts.
            Dim atts As New List(Of IAttachment)
            If rawMsg.Attachments IsNot Nothing Then atts.AddRange(rawMsg.Attachments)
            Dim partCount As Integer = Math.Max(1, atts.Count)
            For part As Integer = 0 To partCount - 1
                Dim pText As String = If(part = 0, content.text, "")
                Dim pType As String = content.mediaType
                Dim pUrl As String = content.mediaUrl
                Dim pName As String = ""
                Dim pSize As Long = 0
                Dim pPending As Boolean = False
                Dim pError As String = ""
                Dim pUid As String = If(part = 0, baseUid, baseUid & "#" & part.ToString())
                Dim att As IAttachment = If(part < atts.Count, atts(part), Nothing)
                If att IsNot Nothing Then
                    pType = DiscordAttachmentKind(att)
                    pName = If(att.Filename, "")
                    pSize = att.Size
                    pUrl = ""
                    If part = 0 AndAlso String.IsNullOrEmpty(pText) Then pText = "[" & Char.ToUpper(pType(0)) & pType.Substring(1) & "]"
                    If pSize > MEDIA_MAX_BYTES Then
                        pError = "File is larger than 50 MB — open it in Discord."
                    ElseIf pSize > MEDIA_INLINE_AWAIT_MAX Then
                        pPending = True
                    Else
                        Try
                            pUrl = Await DownloadDiscordAttachmentAsync(att.Url, att.ContentType, pName)
                        Catch ex As Exception
                            pError = "Download failed: " & ex.Message
                        End Try
                        If pUrl = "" AndAlso pError = "" Then pError = "Download failed — open it in Discord."
                    End If
                End If

                PostToJS("newMessage", New With {
                    .platform = "discord",
                    .id = rawMsg.Id.ToString(),
                    .uid = pUid,
                    .part = part,
                    .chatId = chIdStr,
                    .chatType = chatType,
                    .name = convName,
                    .handle = handleStr,
                    .avatar = avatarUrl,
                    .bio = "",
                    .coverUrl = "",
                    .text = pText,
                    .mediaType = pType,
                    .mediaUrl = pUrl,
                    .fileName = pName,
                    .fileSize = pSize,
                    .mediaPending = pPending,
                    .mediaError = pError,
                    .replyToId = If(part = 0, replyToId, ""),
                    .replyText = If(part = 0, replyText, ""),
                    .replyFromSelf = replyFromSelf,
                    .mentioned = mentioned,
                    .replyToBot = replyToBot,
                    .t = rawMsg.Timestamp.ToLocalTime().ToString("HH:mm"),
                    .channelName = channelName,
                    .guildId = guildId
                })

                If pPending Then
                    Dim aUrl As String = att.Url, aCt As String = att.ContentType, aName As String = pName
                    DownloadInBackground("discord", chIdStr, rawMsg.Id.ToString(), pUid, pType, pName,
                                         Function() DownloadDiscordAttachmentAsync(aUrl, aCt, aName))
                End If
            Next
        Catch ex As Exception
            PostToJS("discordError", New With {.error = ex.Message})
        End Try
        Await Task.CompletedTask
    End Function


#End Region

#Region "Send dispatcher"



    Private Function DecodeDataUrl(url As String) As (Bytes As Byte(), Mime As String, Ext As String)
        If String.IsNullOrEmpty(url) OrElse Not url.StartsWith("data:", StringComparison.OrdinalIgnoreCase) Then Return (Nothing, "", "")
        Dim comma As Integer = url.IndexOf(","c)
        If comma < 0 Then Return (Nothing, "", "")
        Dim header As String = url.Substring(5, comma - 5)
        Dim payload As String = url.Substring(comma + 1)
        Dim mime As String = ""
        Dim isBase64 As Boolean = False
        For Each part As String In header.Split(";"c)
            If part.Equals("base64", StringComparison.OrdinalIgnoreCase) Then
                isBase64 = True
            ElseIf part.Contains("/") Then
                mime = part
            End If
        Next
        If mime = "" Then mime = "application/octet-stream"
        Dim ext As String = "bin"
        Select Case mime.ToLowerInvariant()
            Case "image/jpeg", "image/jpg" : ext = "jpg"
            Case "image/png" : ext = "png"
            Case "image/gif" : ext = "gif"
            Case "image/webp" : ext = "webp"
            Case "image/bmp" : ext = "bmp"
            Case "video/mp4" : ext = "mp4"
            Case "video/quicktime" : ext = "mov"
            Case "video/webm" : ext = "webm"
            Case "audio/mpeg", "audio/mp3" : ext = "mp3"
            Case "audio/ogg" : ext = "ogg"
            Case "audio/wav", "audio/x-wav" : ext = "wav"
            Case "audio/m4a", "audio/mp4", "audio/x-m4a" : ext = "m4a"
            Case "application/pdf" : ext = "pdf"
            Case "application/zip", "application/x-zip-compressed" : ext = "zip"
            Case "application/x-rar-compressed", "application/vnd.rar" : ext = "rar"
            Case "application/x-7z-compressed" : ext = "7z"
            Case "application/gzip", "application/x-gzip" : ext = "gz"
            Case "application/x-tar" : ext = "tar"
            Case "application/vnd.android.package-archive" : ext = "apk"
            Case "application/vnd.microsoft.portable-executable", "application/x-msdownload" : ext = "exe"
            Case "application/x-msi" : ext = "msi"
            Case "application/json" : ext = "json"
            Case "application/xml", "text/xml" : ext = "xml"
            Case "text/plain" : ext = "txt"
            Case "text/csv" : ext = "csv"
            Case "text/html" : ext = "html"
            Case "application/msword" : ext = "doc"
            Case "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : ext = "docx"
            Case "application/vnd.ms-excel" : ext = "xls"
            Case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : ext = "xlsx"
            Case "application/vnd.ms-powerpoint" : ext = "ppt"
            Case "application/vnd.openxmlformats-officedocument.presentationml.presentation" : ext = "pptx"
        End Select
        Try
            Dim bytes() As Byte
            If isBase64 Then
                bytes = Convert.FromBase64String(payload)
            Else
                bytes = System.Text.Encoding.UTF8.GetBytes(System.Net.WebUtility.UrlDecode(payload))
            End If
            Return (bytes, mime, ext)
        Catch
            Return (Nothing, "", "")
        End Try
    End Function




#Region "Outbound: send, reply, edit, delete"

    ' Every successful send reports the platform's id for the new message
    ' (messageId + uid). Without it nothing sent from the app could later be
    ' replied to, edited or deleted. reqId is the page's own tag for the send.
    Private Sub PostSendOk(platform As String, chatId As String, kind As String, messageId As String,
                           uid As String, reqId As String, text As String)
        PostToJS("sendOk", New With {.platform = platform, .chatId = chatId, .kind = kind,
                                     .messageId = messageId, .uid = uid, .reqId = reqId, .text = text})
    End Sub

    ' text is echoed so the page can match a failure to its bubble even
    ' when a send somehow went out without a reqId.
    Private Sub PostSendError(platform As String, chatId As String, errMsg As String, reqId As String,
                              Optional text As String = "")
        PostToJS("sendError", New With {.platform = platform, .chatId = chatId, .error = errMsg, .reqId = reqId, .text = text})
    End Sub

    ' Which Telegram API a send goes through. A reply must use the API whose
    ' numbering the quoted id belongs to: the bot and the user account see
    ' the same conversation under different message ids.
    Private Function PickTelegramApi(via As String) As String
        Dim botUp As Boolean = tgBotClient IsNot Nothing AndAlso tgConnected
        Dim userUp As Boolean = tgUserClient IsNot Nothing AndAlso tgUserConnected
        If via = "user" AndAlso userUp Then Return "user"
        If via = "bot" AndAlso botUp Then Return "bot"
        If botUp Then Return "bot"
        If userUp Then Return "user"
        Return ""
    End Function

    ' ── Raw Bot API ──────────────────────────────────────────────────
    ' Reply / edit / delete go straight to the HTTP API. The Telegram.Bot
    ' package renamed these parameters between versions (replyToMessageId →
    ' replyParameters); the wire format has not changed, so this builds
    ' against whichever package version the project has.
    Private Async Function TgBotRawAsync(method As String, payload As JObject) As Task(Of JToken)
        Dim url As String = "https://api.telegram.org/bot" & tgToken & "/" & method
        Using body As New StringContent(payload.ToString(Newtonsoft.Json.Formatting.None), System.Text.Encoding.UTF8, "application/json")
            Dim resp = Await HttpBig.PostAsync(url, body)
            Dim txt As String = Await resp.Content.ReadAsStringAsync()
            Dim j As JObject = JObject.Parse(txt)
            If j.Value(Of Boolean)("ok") Then Return j("result")
            Throw New Exception(If(j.Value(Of String)("description"), "Telegram error " & CInt(resp.StatusCode).ToString()))
        End Using
    End Function

    Private Async Function TgBotRawUploadAsync(method As String, field As String, chatId As Long,
                                               bytes As Byte(), fileName As String, urlValue As String,
                                               caption As String, replyId As Integer) As Task(Of JToken)
        Dim url As String = "https://api.telegram.org/bot" & tgToken & "/" & method
        Using form As New MultipartFormDataContent()
            form.Add(New StringContent(chatId.ToString()), "chat_id")
            If Not String.IsNullOrEmpty(caption) Then form.Add(New StringContent(caption), "caption")
            If replyId > 0 Then
                form.Add(New StringContent("{""message_id"":" & replyId.ToString() & ",""allow_sending_without_reply"":true}"), "reply_parameters")
            End If
            If bytes IsNot Nothing Then
                form.Add(New ByteArrayContent(bytes), field, fileName)
            Else
                form.Add(New StringContent(urlValue), field)
            End If
            Dim resp = Await HttpBig.PostAsync(url, form)
            Dim txt As String = Await resp.Content.ReadAsStringAsync()
            Dim j As JObject = JObject.Parse(txt)
            If j.Value(Of Boolean)("ok") Then Return j("result")
            Throw New Exception(If(j.Value(Of String)("description"), "Telegram error " & CInt(resp.StatusCode).ToString()))
        End Using
    End Function

    Private Shared Function JObj(ParamArray kv As Object()) As JObject
        Dim o As New JObject()
        For i As Integer = 0 To kv.Length - 2 Step 2
            Dim v As Object = kv(i + 1)
            If TypeOf v Is JToken Then
                o(CStr(kv(i))) = CType(v, JToken)
            Else
                o(CStr(kv(i))) = New JValue(v)
            End If
        Next
        Return o
    End Function

    ' ── Text ─────────────────────────────────────────────────────────
    Private Sub SendPlatformMessage(platform As String, chatId As String, text As String,
                                    Optional replyTo As String = "", Optional replyVia As String = "", Optional reqId As String = "")
        Select Case platform
            Case "telegram" : SendTelegramMessage(chatId, text, replyTo, replyVia, reqId)
            Case "discord" : SendDiscordMessage(chatId, text, replyTo, reqId)
            Case Else : PostSendError(platform, chatId, "Unknown platform: " & platform, reqId, text)
        End Select
    End Sub

    Private Async Sub SendTelegramMessage(chatId As String, text As String,
                                          Optional replyTo As String = "", Optional replyVia As String = "", Optional reqId As String = "")
        Dim api As String = PickTelegramApi(replyVia)
        If api = "" Then PostSendError("telegram", chatId, "Telegram not connected.", reqId, text) : Return
        Dim replyId As Integer = 0
        If replyVia = "" OrElse replyVia = api Then Integer.TryParse(If(replyTo, ""), replyId)
        If api = "user" Then SendTelegramUserMessage(chatId, text, replyId, reqId) : Return
        Try
            Dim parsedId As Long
            If Not Long.TryParse(chatId, parsedId) Then PostSendError("telegram", chatId, "Invalid chat ID: " & chatId, reqId, text) : Return
            Dim mid As Long = 0
            If replyId > 0 Then
                Dim res = Await TgBotRawAsync("sendMessage", JObj("chat_id", parsedId, "text", text,
                    "reply_parameters", JObj("message_id", replyId, "allow_sending_without_reply", True)))
                mid = res.Value(Of Long)("message_id")
            Else
                Dim sent As Telegram.Bot.Types.Message = Await tgBotClient.SendTextMessageAsync(chatId:=New Telegram.Bot.Types.ChatId(parsedId), text:=text)
                If sent IsNot Nothing Then mid = sent.MessageId
            End If
            PostSendOk("telegram", chatId, "text", mid.ToString(), If(mid > 0, "tg:" & chatId & ":" & mid.ToString(), ""), reqId, text)
        Catch ex As Exception
            PostSendError("telegram", chatId, ex.Message, reqId, text)
        End Try
    End Sub

    Private Async Sub SendTelegramUserMessage(chatId As String, text As String, Optional replyId As Integer = 0, Optional reqId As String = "")
        If tgUserClient Is Nothing OrElse Not tgUserConnected Then
            PostSendError("telegram", chatId, "Telegram User API not connected.", reqId, text) : Return
        End If
        Try
            Dim parsedId As Long
            If Not Long.TryParse(chatId, parsedId) Then PostSendError("telegram", chatId, "Invalid chat ID: " & chatId, reqId, text) : Return
            Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedId)
            If peer Is Nothing Then
                PostSendError("telegram", chatId, "Could not resolve peer. If this is a new contact, send them a message via Telegram first to establish the access_hash, or ensure they are a mutual contact.", reqId, text)
                Return
            End If
            Dim sent As TL.Message = Nothing
            Dim retryPlain As Boolean = False
            Try
                sent = Await tgUserClient.SendMessageAsync(peer, text, Nothing, replyId)
            Catch exReply As Exception
                ' The quoted message may have been deleted meanwhile — the
                ' words still matter more than the quote.
                If replyId > 0 Then retryPlain = True Else Throw
            End Try
            If retryPlain Then sent = Await tgUserClient.SendMessageAsync(peer, text)
            Dim mid As Integer = 0
            If sent IsNot Nothing Then
                Dim sb As TL.MessageBase = sent
                mid = sb.ID
            End If
            PostSendOk("telegram", chatId, "text", mid.ToString(), If(mid > 0, "tgu:" & chatId & ":" & mid.ToString(), ""), reqId, text)
        Catch ex As Exception
            PostSendError("telegram", chatId, ex.Message, reqId, text)
        End Try
    End Sub

    ' Resolves a Discord channel id (guild channel or DM channel) or, for a
    ' cold outbound, a user id to their DM channel.
    Private Async Function ResolveDiscordChannelAsync(id As ULong) As Task(Of IMessageChannel)
        If dcClient Is Nothing Then Return Nothing
        Dim ch As IMessageChannel = TryCast(dcClient.GetChannel(id), IMessageChannel)
        If ch IsNot Nothing Then Return ch
        Dim cached As IDMChannel = Nothing
        If _dcDmCache.TryGetValue(id, cached) Then Return cached
        Try
            Dim rc = Await dcClient.Rest.GetChannelAsync(id)
            ch = TryCast(rc, IMessageChannel)
            If ch IsNot Nothing Then Return ch
        Catch
        End Try
        Try
            Dim user = Await dcClient.Rest.GetUserAsync(id)
            If user IsNot Nothing Then
                Dim dm = Await user.CreateDMChannelAsync()
                If dm IsNot Nothing Then
                    _dcDmCache(id) = dm
                    Return dm
                End If
            End If
        Catch
        End Try
        Return Nothing
    End Function

    Private Async Sub SendDiscordMessage(channelId As String, text As String, Optional replyTo As String = "", Optional reqId As String = "")
        If dcClient Is Nothing OrElse Not dcConnected Then PostSendError("discord", channelId, "Discord not connected.", reqId, text) : Return
        Try
            Dim id As ULong
            If Not ULong.TryParse(channelId, id) Then PostSendError("discord", channelId, "Invalid channel ID: " & channelId, reqId, text) : Return
            Dim ch As IMessageChannel = Await ResolveDiscordChannelAsync(id)
            If ch Is Nothing Then PostSendError("discord", channelId, "Channel not found or bot lacks access.", reqId, text) : Return
            Dim refId As ULong = 0
            ULong.TryParse(If(replyTo, ""), refId)
            Dim sent As IUserMessage = Nothing
            Dim retryPlain As Boolean = False
            If refId > 0 Then
                Try
                    sent = Await ch.SendMessageAsync(text, messageReference:=New MessageReference(refId))
                Catch
                    retryPlain = True
                End Try
            End If
            If sent Is Nothing AndAlso (refId = 0 OrElse retryPlain) Then sent = Await ch.SendMessageAsync(text)
            Dim mid As String = If(sent IsNot Nothing, sent.Id.ToString(), "")
            PostSendOk("discord", channelId, "text", mid, If(mid <> "", "dc:" & channelId & ":" & mid, ""), reqId, text)
        Catch ex As Exception
            PostSendError("discord", channelId, ex.Message, reqId, text)
        End Try
    End Sub

    ' ── Media ────────────────────────────────────────────────────────
    Private Sub SendPlatformMedia(platform As String, chatId As String, mediaUrl As String, caption As String, mediaKind As String,
                                  Optional fileName As String = "", Optional replyTo As String = "",
                                  Optional replyVia As String = "", Optional reqId As String = "")
        mediaUrl = LocalMediaToDataUrl(mediaUrl)
        Select Case platform
            Case "telegram" : SendTelegramMedia(chatId, mediaUrl, caption, mediaKind, fileName, replyTo, replyVia, reqId)
            Case "discord" : SendDiscordMedia(chatId, mediaUrl, caption, mediaKind, fileName, replyTo, reqId)
            Case Else : PostSendError(platform, chatId, "Unknown platform: " & platform, reqId)
        End Select
    End Sub

    Private Function OutFileName(fileName As String, kind As String, ext As String) As String
        If Not String.IsNullOrWhiteSpace(fileName) Then Return fileName
        Dim k As String = If(kind, "").ToLowerInvariant()
        Dim stem As String = If(k = "photo" OrElse k = "image", "image", If(k = "video", "video", If(k = "audio" OrElse k = "voice", "audio", "file")))
        Return stem & "." & If(String.IsNullOrEmpty(ext), "bin", ext)
    End Function

    Private Async Sub SendTelegramMedia(chatId As String, mediaUrl As String, caption As String, mediaKind As String,
                                        Optional fileName As String = "", Optional replyTo As String = "",
                                        Optional replyVia As String = "", Optional reqId As String = "")
        Dim api As String = PickTelegramApi(replyVia)
        If api = "" Then PostSendError("telegram", chatId, "Telegram not connected.", reqId) : Return
        Dim replyId As Integer = 0
        If replyVia = "" OrElse replyVia = api Then Integer.TryParse(If(replyTo, ""), replyId)
        If api = "user" Then SendTelegramUserMedia(chatId, mediaUrl, caption, mediaKind, fileName, replyId, reqId) : Return
        Try
            Dim parsedId As Long
            If Not Long.TryParse(chatId, parsedId) Then PostSendError("telegram", chatId, "Invalid chat ID: " & chatId, reqId) : Return
            Dim chId As New Telegram.Bot.Types.ChatId(parsedId)
            Dim kind As String = If(mediaKind, "").ToLowerInvariant()
            Dim isData As Boolean = mediaUrl IsNot Nothing AndAlso mediaUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            Dim mid As Long = 0
            Dim method As String, field As String
            Select Case kind
                Case "video" : method = "sendVideo" : field = "video"
                Case "audio", "voice" : method = "sendAudio" : field = "audio"
                Case "document", "doc", "file" : method = "sendDocument" : field = "document"
                Case Else : method = "sendPhoto" : field = "photo"
            End Select
            If isData Then
                Dim decoded = DecodeDataUrl(mediaUrl)
                If decoded.Bytes Is Nothing OrElse decoded.Bytes.Length = 0 Then PostSendError("telegram", chatId, "Invalid data URL.", reqId) : Return
                Dim outName As String = OutFileName(fileName, kind, decoded.Ext)
                If replyId > 0 Then
                    Dim res = Await TgBotRawUploadAsync(method, field, parsedId, decoded.Bytes, outName, "", caption, replyId)
                    mid = res.Value(Of Long)("message_id")
                Else
                    Using ms As New MemoryStream(decoded.Bytes)
                        Dim inputFile As Telegram.Bot.Types.InputFile = Telegram.Bot.Types.InputFile.FromStream(ms, outName)
                        Dim sent As Telegram.Bot.Types.Message = Nothing
                        Select Case field
                            Case "video" : sent = Await tgBotClient.SendVideoAsync(chatId:=chId, video:=inputFile, caption:=caption)
                            Case "audio" : sent = Await tgBotClient.SendAudioAsync(chatId:=chId, audio:=inputFile, caption:=caption)
                            Case "document" : sent = Await tgBotClient.SendDocumentAsync(chatId:=chId, document:=inputFile, caption:=caption)
                            Case Else : sent = Await tgBotClient.SendPhotoAsync(chatId:=chId, photo:=inputFile, caption:=caption)
                        End Select
                        If sent IsNot Nothing Then mid = sent.MessageId
                    End Using
                End If
            Else
                If replyId > 0 Then
                    Dim res = Await TgBotRawUploadAsync(method, field, parsedId, Nothing, "", mediaUrl, caption, replyId)
                    mid = res.Value(Of Long)("message_id")
                Else
                    Dim inputFile As Telegram.Bot.Types.InputFile = Telegram.Bot.Types.InputFile.FromUri(mediaUrl)
                    Dim sent As Telegram.Bot.Types.Message = Nothing
                    Select Case field
                        Case "video" : sent = Await tgBotClient.SendVideoAsync(chatId:=chId, video:=inputFile, caption:=caption)
                        Case "audio" : sent = Await tgBotClient.SendAudioAsync(chatId:=chId, audio:=inputFile, caption:=caption)
                        Case "document" : sent = Await tgBotClient.SendDocumentAsync(chatId:=chId, document:=inputFile, caption:=caption)
                        Case Else : sent = Await tgBotClient.SendPhotoAsync(chatId:=chId, photo:=inputFile, caption:=caption)
                    End Select
                    If sent IsNot Nothing Then mid = sent.MessageId
                End If
            End If
            PostSendOk("telegram", chatId, "media", mid.ToString(), If(mid > 0, "tg:" & chatId & ":" & mid.ToString(), ""), reqId, caption)
        Catch ex As Exception
            PostSendError("telegram", chatId, ex.Message, reqId)
        End Try
    End Sub

    Private Async Sub SendTelegramUserMedia(chatId As String, mediaUrl As String, caption As String, mediaKind As String,
                                            Optional fileName As String = "", Optional replyId As Integer = 0, Optional reqId As String = "")
        If tgUserClient Is Nothing OrElse Not tgUserConnected Then PostSendError("telegram", chatId, "Telegram User API not connected.", reqId) : Return
        Try
            Dim parsedId As Long
            If Not Long.TryParse(chatId, parsedId) Then PostSendError("telegram", chatId, "Invalid chat ID: " & chatId, reqId) : Return
            Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedId)
            If peer Is Nothing Then PostSendError("telegram", chatId, "Peer not resolved.", reqId) : Return
            Dim bytes As Byte()
            Dim mime As String
            Dim ext As String
            If mediaUrl IsNot Nothing AndAlso mediaUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase) Then
                Dim decoded = DecodeDataUrl(mediaUrl)
                If decoded.Bytes Is Nothing OrElse decoded.Bytes.Length = 0 Then PostSendError("telegram", chatId, "Invalid data URL.", reqId) : Return
                bytes = decoded.Bytes : mime = decoded.Mime : ext = decoded.Ext
            Else
                Dim resp = Await HttpBig.GetAsync(mediaUrl)
                resp.EnsureSuccessStatusCode()
                bytes = Await resp.Content.ReadAsByteArrayAsync()
                mime = If(resp.Content.Headers.ContentType IsNot Nothing, resp.Content.Headers.ContentType.MediaType, "application/octet-stream")
                ext = ExtForMime(mime).TrimStart("."c)
            End If
            ' The data URL's own MIME wins; a generic one is refined from the
            ' filename so a .pdf isn't uploaded as octet-stream.
            If (String.IsNullOrEmpty(mime) OrElse mime = "application/octet-stream") AndAlso Not String.IsNullOrEmpty(fileName) Then
                Select Case Path.GetExtension(fileName).ToLowerInvariant()
                    Case ".pdf" : mime = "application/pdf"
                    Case ".zip" : mime = "application/zip"
                    Case ".png" : mime = "image/png"
                    Case ".jpg", ".jpeg" : mime = "image/jpeg"
                    Case ".txt" : mime = "text/plain"
                    Case ".json" : mime = "application/json"
                    Case ".mp4" : mime = "video/mp4"
                    Case ".mp3" : mime = "audio/mpeg"
                End Select
            End If
            Dim kind As String = If(mediaKind, "").ToLowerInvariant()
            Dim outName As String = OutFileName(fileName, kind, ext)
            Dim sent As TL.Message = Nothing
            Using ms As New MemoryStream(bytes)
                Dim uploaded As TL.InputFileBase = Await tgUserClient.UploadFileAsync(ms, outName)
                Dim media As TL.InputMedia
                If kind = "photo" OrElse kind = "image" Then
                    media = New TL.InputMediaUploadedPhoto With {.file = uploaded}
                Else
                    ' Video, audio and files all go as documents: a video sent
                    ' as a "photo" used to fail outright.
                    media = New TL.InputMediaUploadedDocument(uploaded, If(String.IsNullOrEmpty(mime), "application/octet-stream", mime))
                End If
                Dim retryPlain As Boolean = False
                Try
                    sent = Await tgUserClient.SendMessageAsync(peer, caption, media, replyId)
                Catch
                    If replyId > 0 Then retryPlain = True Else Throw
                End Try
                If retryPlain Then sent = Await tgUserClient.SendMessageAsync(peer, caption, media)
            End Using
            Dim mid As Integer = 0
            If sent IsNot Nothing Then
                Dim sb As TL.MessageBase = sent
                mid = sb.ID
            End If
            PostSendOk("telegram", chatId, "media", mid.ToString(), If(mid > 0, "tgu:" & chatId & ":" & mid.ToString(), ""), reqId, caption)
        Catch ex As Exception
            PostSendError("telegram", chatId, ex.Message, reqId)
        End Try
    End Sub

    Private Async Sub SendDiscordMedia(channelId As String, mediaUrl As String, caption As String, mediaKind As String,
                                       Optional fileName As String = "", Optional replyTo As String = "", Optional reqId As String = "")
        If dcClient Is Nothing OrElse Not dcConnected Then PostSendError("discord", channelId, "Discord not connected.", reqId) : Return
        Try
            Dim id As ULong
            If Not ULong.TryParse(channelId, id) Then PostSendError("discord", channelId, "Invalid channel ID: " & channelId, reqId) : Return
            Dim ch As IMessageChannel = Await ResolveDiscordChannelAsync(id)
            If ch Is Nothing Then PostSendError("discord", channelId, "Channel not found.", reqId) : Return
            Dim refId As ULong = 0
            ULong.TryParse(If(replyTo, ""), refId)
            Dim ref As MessageReference = If(refId > 0, New MessageReference(refId), Nothing)
            Dim sent As IUserMessage = Nothing
            Dim isData As Boolean = mediaUrl IsNot Nothing AndAlso mediaUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            If isData Then
                Dim decoded = DecodeDataUrl(mediaUrl)
                If decoded.Bytes Is Nothing OrElse decoded.Bytes.Length = 0 Then PostSendError("discord", channelId, "Invalid data URL.", reqId) : Return
                Dim outName As String = OutFileName(fileName, mediaKind, decoded.Ext)
                Dim retryPlain As Boolean = False
                Using ms As New MemoryStream(decoded.Bytes)
                    Try
                        sent = Await ch.SendFileAsync(ms, outName, text:=caption, messageReference:=ref)
                    Catch
                        If ref IsNot Nothing Then retryPlain = True Else Throw
                    End Try
                End Using
                If retryPlain Then
                    Using ms2 As New MemoryStream(decoded.Bytes)
                        sent = Await ch.SendFileAsync(ms2, outName, text:=caption)
                    End Using
                End If
            Else
                Dim msg As String = If(String.IsNullOrEmpty(caption), mediaUrl, caption & vbCrLf & mediaUrl)
                Dim retryPlain As Boolean = False
                Try
                    sent = Await ch.SendMessageAsync(msg, messageReference:=ref)
                Catch
                    If ref IsNot Nothing Then retryPlain = True Else Throw
                End Try
                If retryPlain Then sent = Await ch.SendMessageAsync(msg)
            End If
            Dim mid As String = If(sent IsNot Nothing, sent.Id.ToString(), "")
            PostSendOk("discord", channelId, "media", mid, If(mid <> "", "dc:" & channelId & ":" & mid, ""), reqId, caption)
        Catch ex As Exception
            PostSendError("discord", channelId, ex.Message, reqId)
        End Try
    End Sub

    ' ── Edit ─────────────────────────────────────────────────────────
    ' via: "user" | "bot" for Telegram — which API sent the message (from its
    ' uid prefix). A bot can only edit what the bot sent, and vice versa.
    Private Async Sub EditPlatformMessage(platform As String, chatId As String, messageId As String, text As String,
                                          via As String, reqId As String)
        Dim errMsg As String = ""
        Try
            Select Case platform
                Case "telegram"
                    Dim parsedChat As Long, mid As Integer
                    If Not Long.TryParse(chatId, parsedChat) OrElse Not Integer.TryParse(messageId, mid) Then Throw New Exception("Invalid message reference.")
                    If via = "user" Then
                        If tgUserClient Is Nothing OrElse Not tgUserConnected Then Throw New Exception("Telegram User API not connected.")
                        Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedChat)
                        If peer Is Nothing Then Throw New Exception("Peer not resolved.")
                        Await tgUserClient.Messages_EditMessage(peer, mid, text)
                    Else
                        If tgBotClient Is Nothing OrElse Not tgConnected Then Throw New Exception("Telegram bot not connected.")
                        Dim needCaption As Boolean = False
                        Dim notModified As Boolean = False
                        Try
                            Await TgBotRawAsync("editMessageText", JObj("chat_id", parsedChat, "message_id", mid, "text", text))
                        Catch exT As Exception
                            Dim m As String = exT.Message.ToLowerInvariant()
                            If m.Contains("not modified") Then
                                notModified = True
                            ElseIf m.Contains("no text") Then
                                needCaption = True
                            Else
                                Throw
                            End If
                        End Try
                        If needCaption Then
                            Await TgBotRawAsync("editMessageCaption", JObj("chat_id", parsedChat, "message_id", mid, "caption", text))
                        End If
                    End If
                Case "discord"
                    Dim chId As ULong, mid As ULong
                    If Not ULong.TryParse(chatId, chId) OrElse Not ULong.TryParse(messageId, mid) Then Throw New Exception("Invalid message reference.")
                    If dcClient Is Nothing OrElse Not dcConnected Then Throw New Exception("Discord not connected.")
                    Dim ch As IMessageChannel = Await ResolveDiscordChannelAsync(chId)
                    If ch Is Nothing Then Throw New Exception("Channel not found.")
                    Dim newText As String = text
                    Await ch.ModifyMessageAsync(mid, Sub(p) p.Content = newText)
                Case Else
                    Throw New Exception("Unknown platform: " & platform)
            End Select
        Catch ex As Exception
            errMsg = ex.Message
        End Try
        PostToJS("editResult", New With {.platform = platform, .chatId = chatId, .messageId = messageId,
                                         .reqId = reqId, .ok = (errMsg = ""), .error = errMsg, .text = text})
    End Sub

    ' ── Delete (for everyone) ────────────────────────────────────────
    ' Telegram: any message in a private chat (bots: under 48h old); in
    ' groups the account needs delete rights for other people's messages.
    ' Discord: the bot's own messages anywhere; other people's only in a
    ' server where it has Manage Messages — never in DMs.
    Private Async Sub DeletePlatformMessages(platform As String, chatId As String, ids As List(Of String),
                                             via As String, reqId As String)
        Dim errMsg As String = ""
        Dim done As New List(Of String)
        Try
            If ids Is Nothing OrElse ids.Count = 0 Then Throw New Exception("Nothing to delete.")
            Select Case platform
                Case "telegram"
                    Dim parsedChat As Long
                    If Not Long.TryParse(chatId, parsedChat) Then Throw New Exception("Invalid chat ID.")
                    Dim intIds As New List(Of Integer)
                    For Each s In ids
                        Dim v As Integer
                        If Integer.TryParse(s, v) AndAlso v > 0 Then intIds.Add(v)
                    Next
                    If intIds.Count = 0 Then Throw New Exception("Invalid message ids.")
                    If via = "user" Then
                        If tgUserClient Is Nothing OrElse Not tgUserConnected Then Throw New Exception("Telegram User API not connected.")
                        Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedChat)
                        If peer Is Nothing Then Throw New Exception("Peer not resolved.")
                        If TypeOf peer Is TL.InputPeerChannel Then
                            Dim pc As TL.InputPeerChannel = CType(peer, TL.InputPeerChannel)
                            Await tgUserClient.Channels_DeleteMessages(New TL.InputChannel(pc.channel_id, pc.access_hash), intIds.ToArray())
                        Else
                            Await tgUserClient.Messages_DeleteMessages(intIds.ToArray(), True)
                        End If
                        For Each v In intIds : done.Add(v.ToString()) : Next
                    Else
                        If tgBotClient Is Nothing OrElse Not tgConnected Then Throw New Exception("Telegram bot not connected.")
                        For Each v In intIds
                            Dim failMsg As String = ""
                            Try
                                Await TgBotRawAsync("deleteMessage", JObj("chat_id", parsedChat, "message_id", v))
                            Catch exD As Exception
                                failMsg = exD.Message
                            End Try
                            ' "not found" = already gone, which is what was asked.
                            If failMsg = "" OrElse failMsg.ToLowerInvariant().Contains("not found") Then
                                done.Add(v.ToString())
                            ElseIf errMsg = "" Then
                                errMsg = failMsg
                            End If
                        Next
                    End If
                Case "discord"
                    Dim chId As ULong
                    If Not ULong.TryParse(chatId, chId) Then Throw New Exception("Invalid channel ID.")
                    If dcClient Is Nothing OrElse Not dcConnected Then Throw New Exception("Discord not connected.")
                    Dim ch As IMessageChannel = Await ResolveDiscordChannelAsync(chId)
                    If ch Is Nothing Then Throw New Exception("Channel not found.")
                    For Each s In ids
                        Dim mid As ULong
                        If Not ULong.TryParse(s, mid) Then Continue For
                        Dim failMsg As String = ""
                        Try
                            Await ch.DeleteMessageAsync(mid)
                        Catch exD As Exception
                            failMsg = exD.Message
                        End Try
                        If failMsg = "" OrElse failMsg.Contains("10008") OrElse failMsg.ToLowerInvariant().Contains("unknown message") Then
                            done.Add(s)
                        ElseIf errMsg = "" Then
                            errMsg = If(failMsg.Contains("50003") OrElse failMsg.Contains("50013"),
                                        "Discord doesn't allow the bot to delete this message.", failMsg)
                        End If
                    Next
                Case Else
                    Throw New Exception("Unknown platform: " & platform)
            End Select
        Catch ex As Exception
            errMsg = ex.Message
        End Try
        PostToJS("deleteResult", New With {.platform = platform, .chatId = chatId, .messageIds = done,
                                           .requested = ids, .reqId = reqId,
                                           .ok = (errMsg = "" AndAlso done.Count > 0), .error = errMsg})
    End Sub

#End Region

    Private Sub SendPlatformChatAction(platform As String, chatId As String, action As String)
        Select Case platform
            Case "telegram" : SendTelegramChatAction(chatId, action)
            Case "discord" : SendDiscordChatAction(chatId, action)
        End Select
    End Sub

    Private Async Sub SendTelegramChatAction(chatId As String, action As String)
        Dim ca As Telegram.Bot.Types.Enums.ChatAction = Telegram.Bot.Types.Enums.ChatAction.Typing
        Select Case action.ToLowerInvariant()
            Case "upload_photo" : ca = Telegram.Bot.Types.Enums.ChatAction.UploadPhoto
            Case "record_voice", "record_audio" : ca = Telegram.Bot.Types.Enums.ChatAction.RecordVoice
            Case "upload_voice", "upload_audio" : ca = Telegram.Bot.Types.Enums.ChatAction.UploadVoice
        End Select
        Dim parsedId As Long
        If Not Long.TryParse(chatId, parsedId) Then Return
        If tgBotClient IsNot Nothing AndAlso tgConnected Then
            Try : Await tgBotClient.SendChatActionAsync(chatId:=New Telegram.Bot.Types.ChatId(parsedId), chatAction:=ca) : Catch : End Try
            Return
        End If
        If tgUserClient IsNot Nothing AndAlso tgUserConnected Then
            Try
                Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedId)
                If peer IsNot Nothing Then
                    Await tgUserClient.Messages_SetTyping(peer, New TL.SendMessageTypingAction())
                End If
            Catch
            End Try
        End If
    End Sub

    Private Async Sub SendDiscordChatAction(channelId As String, action As String)
        If dcClient Is Nothing OrElse Not dcConnected Then Return
        If Not action.Equals("typing", StringComparison.OrdinalIgnoreCase) Then Return
        Try
            Dim id As ULong
            If Not ULong.TryParse(channelId, id) Then Return
            Dim ch As IMessageChannel = TryCast(dcClient.GetChannel(id), IMessageChannel)
            If ch Is Nothing Then
                Dim cached As IDMChannel = Nothing
                If _dcDmCache.TryGetValue(id, cached) Then ch = cached
            End If
            If ch Is Nothing Then
                Try
                    Dim user = Await dcClient.Rest.GetUserAsync(id)
                    If user IsNot Nothing Then
                        Dim dm = Await user.CreateDMChannelAsync()
                        If dm IsNot Nothing Then _dcDmCache(id) = dm : ch = dm
                    End If
                Catch
                End Try
            End If
            If ch IsNot Nothing Then Await ch.TriggerTypingAsync()
        Catch
        End Try
    End Sub

    Private Sub SendPlatformMarkRead(platform As String, chatId As String, maxId As Integer)
        Select Case platform
            Case "telegram" : SendTelegramMarkRead(chatId, maxId)
        End Select
    End Sub

    Private Async Sub SendTelegramMarkRead(chatId As String, maxId As Integer)
        Try
            Dim parsedId As Long
            If Not Long.TryParse(chatId, parsedId) Then
                PostToJS("readReceiptResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "bad chat id"})
                Return
            End If
            If tgUserClient IsNot Nothing AndAlso tgUserConnected Then
                Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedId)
                If peer Is Nothing Then
                    PostToJS("readReceiptResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "peer not resolved"})
                    Return
                End If
                Try
                    Await tgUserClient.ReadHistory(peer)
                    PostToJS("readReceiptResult", New With {.platform = "telegram", .chatId = chatId, .ok = True, .path = "user_api", .maxId = maxId})
                Catch exInner As Exception
                    PostToJS("readReceiptResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "ReadHistory threw: " & exInner.Message})
                End Try
                Return
            End If
            If tgBotClient IsNot Nothing AndAlso tgConnected Then
                PostToJS("readReceiptResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "Bot API does not support read receipts."})
                Return
            End If
            PostToJS("readReceiptResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "no telegram client connected"})
        Catch ex As Exception
            PostToJS("readReceiptResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = ex.Message})
        End Try
    End Sub

#End Region

#Region "Block / unblock"

    Private Sub BlockPlatformUser(platform As String, chatId As String)
        Select Case platform.ToLowerInvariant()
            Case "telegram" : BlockTelegramUser(chatId)
            Case "discord" : PostToJS("blockResult", New With {.platform = "discord", .chatId = chatId, .ok = True, .reason = "Discord bots cannot block — DB flag active."})
            Case Else : PostToJS("blockResult", New With {.platform = platform, .chatId = chatId, .ok = False, .reason = "Unknown platform."})
        End Select
    End Sub

    Private Sub UnblockPlatformUser(platform As String, chatId As String)
        Select Case platform.ToLowerInvariant()
            Case "telegram" : UnblockTelegramUser(chatId)
            Case "discord" : PostToJS("blockResult", New With {.platform = "discord", .chatId = chatId, .ok = True, .reason = "No platform-side block — DB flag cleared."})
            Case Else : PostToJS("blockResult", New With {.platform = platform, .chatId = chatId, .ok = False, .reason = "Unknown platform."})
        End Select
    End Sub

    Private Async Sub BlockTelegramUser(chatId As String)
        Try
            If tgUserClient IsNot Nothing AndAlso tgUserConnected Then
                Dim parsedId As Long
                If Not Long.TryParse(chatId, parsedId) Then
                    PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "chatId not numeric"}) : Return
                End If
                Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedId)
                If peer Is Nothing Then
                    PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "Peer not resolved — DB flag still active."}) : Return
                End If
                Await tgUserClient.Contacts_Block(peer)
                PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = True, .reason = "blocked via User API"})
                Return
            End If
            PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = True, .reason = "Bot API cannot block — DB flag active."})
        Catch ex As Exception
            PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = ex.Message})
        End Try
    End Sub

    Private Async Sub UnblockTelegramUser(chatId As String)
        Try
            If tgUserClient IsNot Nothing AndAlso tgUserConnected Then
                Dim parsedId As Long
                If Not Long.TryParse(chatId, parsedId) Then
                    PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "chatId not numeric"}) : Return
                End If
                Dim peer As TL.InputPeer = Await ResolveTelegramPeerFull(parsedId)
                If peer Is Nothing Then
                    PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = "Peer not resolved."}) : Return
                End If
                Await tgUserClient.Contacts_Unblock(peer)
                PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = True, .reason = "unblocked via User API"})
                Return
            End If
            PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = True, .reason = "Bot API — no platform-side block to lift."})
        Catch ex As Exception
            PostToJS("blockResult", New With {.platform = "telegram", .chatId = chatId, .ok = False, .reason = ex.Message})
        End Try
    End Sub

#End Region

#Region "Window frame"

    ' ── Discord-style window frame ──────────────────────────────────────
    ' The native caption is removed (WM_NCCALCSIZE keeps the side and
    ' bottom sizing frame but gives the top back to the client), and the
    ' app draws its own slim title bar (WindowTitleBar, below). The window
    ' keeps everything a normal window has: resizing on every edge, Aero
    ' Snap, double-click to maximise, the system menu and the shadow.
    '
    ' Border: no accent-coloured outline. On Windows 11 the 1px DWM border
    ' is switched off entirely (DWMWA_COLOR_NONE) once, when the handle is
    ' created, so activating / deactivating the window or changing the
    ' accent never touches DWM. Windows 10 cannot recolour or hide its
    ' border, so there the title bar draws a neutral hairline along its top
    ' edge to line up with the system border on the other three sides.
    '
    ' Theme: the page sends its colours through the bridge ("windowTheme").
    ' Those messages can arrive dozens of times a second while a colour
    ' picker is being dragged, so they are coalesced (at most one repaint
    ' per ~33 ms, always ending on the latest colour) and anything that did
    ' not actually change is skipped.
    '
    ' Resizing: WebView2 lays the page out again at every size step. While
    ' the operator is dragging a window edge the page is put into a
    ' "sizing" state (see SetPageSizing and the page's LIVE WINDOW RESIZE
    ' controller): the background layers stop being re-drawn and are
    ' stretched on the GPU instead, the chat column holds its width, the
    ' 3D ghost stops reallocating its canvas, and measuring code stands
    ' down — then everything settles once when the drag ends. The WebView's
    ' own background colour is the page's edge colour, so any strip the
    ' page has not painted yet blends in instead of showing as a band.
    Private Const WM_NCCALCSIZE As Integer = &H83
    Private Const WM_NCHITTEST As Integer = &H84
    Private Const WM_SIZING As Integer = &H214
    Private Const WM_ENTERSIZEMOVE As Integer = &H231
    Private Const WM_EXITSIZEMOVE As Integer = &H232
    Private Const WM_SYSCOMMAND As Integer = &H112
    Private Const SC_SIZE As Long = &HF000L
    Private Const HT_CLIENT As Integer = 1
    Private Const HT_CAPTION As Integer = 2
    Private Const HT_TOP As Integer = 12
    Private Const HT_TOPLEFT As Integer = 13
    Private Const HT_TOPRIGHT As Integer = 14
    Private Const DWMWA_BORDER_COLOR As Integer = 34
    Private Const DWMWA_COLOR_NONE As Integer = -2        ' 0xFFFFFFFE: no border at all

    ' Shipped look until the page reports otherwise: the Graphite accent over
    ' the Ocean background (see BC_THEME.defaults in bot-ui-settings.jsx).
    Private _winAccent As SD.Color = SD.Color.FromArgb(139, 143, 163)
    Private _winBase1 As SD.Color = SD.Color.FromArgb(2, 11, 16)
    Private _winBase2 As SD.Color = SD.Color.FromArgb(4, 32, 41)
    Private _winBase3 As SD.Color = SD.Color.FromArgb(6, 24, 49)
    ' The colour the page shows along its edges (base tones, darkened by the
    ' vignette). While the window grows faster than the page can repaint,
    ' the newly uncovered strip is filled with this, so it blends into the
    ' page instead of reading as a separate band.
    Private _winEdge As SD.Color = SD.Color.FromArgb(2, 12, 18)
    Private _winActive As Boolean = True

    ' True once DWM accepted "no border" (Windows 11). False on Windows 10,
    ' where the title bar draws its neutral top hairline instead.
    Private _dwmBorderHidden As Boolean = False

    ' Theme coalescing (see header).
    Private Const THEME_APPLY_INTERVAL_MS As Integer = 33
    Private _themeTimer As SWF.Timer = Nothing
    Private _themePending As Boolean = False

    ' Live-resize state (see header).
    Private _inSizeMove As Boolean = False
    Private _pageSizing As Boolean = False
    ' Set by WM_SYSCOMMAND SC_SIZE: the mouse went down on a sizing edge.
    ' Lets the page get ready on the press, before the first resize step.
    Private _sizeCommandPending As Boolean = False
    Private _lastWindowState As SWF.FormWindowState = SWF.FormWindowState.Normal

    ' Installed on every document by Form1_Load. Adds one stylesheet that
    ' only matches while <html data-host-sizing> is set: animations pause
    ' where they are (no jump when they resume) and transitions are off, so
    ' a resize step costs one layout + paint instead of a layout + paint +
    ' every running animation re-rasterised at the new size.
    ' The page itself (BotCommand.html, "LIVE WINDOW RESIZE") listens for
    ' the bc:host-sizing event and freezes its expensive layers; this
    ' stylesheet is the part that works even on a page that doesn't.
    Private Const PAGE_SIZING_SCRIPT As String =
        "(function(){" &
        "if(window.__bcHostSizingCss)return;window.__bcHostSizingCss=1;" &
        "var css='html[data-host-sizing] *,html[data-host-sizing] *::before,html[data-host-sizing] *::after{" &
        "animation-play-state:paused!important;transition:none!important;}';" &
        "function add(){try{if(document.getElementById('bc-host-sizing'))return;" &
        "var s=document.createElement('style');s.id='bc-host-sizing';s.textContent=css;" &
        "(document.head||document.documentElement).appendChild(s);}catch(e){}}" &
        "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add();" &
        "})();"

    <System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)>
    Private Structure NativeRect
        Public Left As Integer
        Public Top As Integer
        Public Right As Integer
        Public Bottom As Integer
    End Structure

    <System.Runtime.InteropServices.DllImport("user32.dll")>
    Private Shared Function IsZoomed(hWnd As IntPtr) As <System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)> Boolean
    End Function

    <System.Runtime.InteropServices.DllImport("user32.dll")>
    Private Shared Function SetWindowPos(hWnd As IntPtr, hWndInsertAfter As IntPtr, x As Integer, y As Integer, cx As Integer, cy As Integer, flags As UInteger) As <System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)> Boolean
    End Function

    Friend Shared Function ScreenPointFromLParam(lp As IntPtr) As SD.Point
        Dim v As Long = lp.ToInt64()
        Dim x As Integer = CInt(v And &HFFFFL)
        Dim y As Integer = CInt((v >> 16) And &HFFFFL)
        If x > 32767 Then x -= 65536
        If y > 32767 Then y -= 65536
        Return New SD.Point(x, y)
    End Function

    Friend Shared Function WinMix(a As SD.Color, b As SD.Color, weightA As Double) As SD.Color
        Dim t As Double = Math.Max(0.0, Math.Min(1.0, weightA))
        Return SD.Color.FromArgb(
            CInt(Math.Round(a.R * t + b.R * (1 - t))),
            CInt(Math.Round(a.G * t + b.G * (1 - t))),
            CInt(Math.Round(a.B * t + b.B * (1 - t))))
    End Function

    Private Shared Function ParseHexColor(value As String, ByRef result As SD.Color) As Boolean
        Dim v As String = If(value, "").Trim()
        If v.StartsWith("#") Then v = v.Substring(1)
        If v.Length <> 6 Then Return False
        Dim n As Integer
        If Not Integer.TryParse(v, System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, n) Then Return False
        result = SD.Color.FromArgb((n >> 16) And 255, (n >> 8) And 255, n And 255)
        Return True
    End Function

    Private Function TopEdgeSize() As Integer
        Dim h As Integer = If(TitleBar IsNot Nothing, TitleBar.Height, 32)
        Return Math.Max(4, CInt(Math.Round(h * 6.0 / 32.0)))
    End Function

    Protected Overrides Sub OnHandleCreated(e As EventArgs)
        MyBase.OnHandleCreated(e)
        Try
            Dim one As Integer = 1
            If DwmSetWindowAttribute(Handle, 20, one, 4) <> 0 Then DwmSetWindowAttribute(Handle, 19, one, 4)
            Dim cornerPref As Integer = 2                    ' DWMWCP_ROUND
            DwmSetWindowAttribute(Handle, 33, cornerPref, 4)      ' DWMWA_WINDOW_CORNER_PREFERENCE
        Catch
        End Try
        ' No accent outline around the window. Set once per handle; DWM keeps
        ' it, so nothing has to be re-sent on activate / theme change.
        Try
            Dim none As Integer = DWMWA_COLOR_NONE
            _dwmBorderHidden = (DwmSetWindowAttribute(Handle, DWMWA_BORDER_COLOR, none, 4) = 0)
        Catch
            _dwmBorderHidden = False
        End Try
        ApplyWindowFrameColors()
        ' Ask Windows to recompute the frame now, so the custom caption is
        ' in place from the very first paint.
        Try
            SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, &H27UI)   ' NOSIZE | NOMOVE | NOZORDER | FRAMECHANGED
        Catch
        End Try
    End Sub

    Protected Overrides Sub WndProc(ByRef m As SWF.Message)
        ' Track an interactive edge drag so the page can be put into its
        ' cheap "sizing" state. Pressing a sizing edge sends SC_SIZE before
        ' the modal size loop starts, so the page is switched over on the
        ' press itself — its one-off restyle is paid before the first
        ' resize step instead of on top of it. A plain move (dragging the
        ' title bar) sends SC_MOVE and never WM_SIZING, so moving the
        ' window leaves the page alone. WM_SIZING stays as the fallback for
        ' sizing that doesn't start from a press (keyboard sizing).
        Select Case m.Msg
            Case WM_SYSCOMMAND
                If (m.WParam.ToInt64() And &HFFF0L) = SC_SIZE Then _sizeCommandPending = True
            Case WM_ENTERSIZEMOVE
                _inSizeMove = True
                If _sizeCommandPending Then
                    _sizeCommandPending = False
                    SetPageSizing(True)
                    BeginOversize()
                End If
            Case WM_SIZING
                If _inSizeMove AndAlso Not _pageSizing Then
                    SetPageSizing(True)
                    BeginOversize()
                End If
            Case WM_EXITSIZEMOVE
                _inSizeMove = False
                _sizeCommandPending = False
                EndOversize()
                SetPageSizing(False)
        End Select

        If m.Msg = WM_NCCALCSIZE AndAlso m.WParam <> IntPtr.Zero Then
            Dim before As NativeRect = CType(System.Runtime.InteropServices.Marshal.PtrToStructure(m.LParam, GetType(NativeRect)), NativeRect)
            MyBase.WndProc(m)
            Dim after As NativeRect = CType(System.Runtime.InteropServices.Marshal.PtrToStructure(m.LParam, GetType(NativeRect)), NativeRect)
            ' Default processing inset every side by the sizing frame and the
            ' top by the caption as well. Keep the sides and bottom, give the
            ' top back. A maximised window hangs its frame off-screen, so
            ' there the top keeps one frame's width (same as the sides).
            Dim frame As Integer = Math.Max(0, after.Left - before.Left)
            after.Top = before.Top + If(IsZoomed(m.HWnd), frame, 0)
            System.Runtime.InteropServices.Marshal.StructureToPtr(after, m.LParam, False)
            m.Result = IntPtr.Zero
            Return
        End If

        If m.Msg = WM_NCHITTEST Then
            MyBase.WndProc(m)
            If m.Result.ToInt64() <> HT_CLIENT Then Return          ' native side / bottom frame
            Dim pt As SD.Point = PointToClient(ScreenPointFromLParam(m.LParam))
            Dim edge As Integer = TopEdgeSize()
            If Not IsZoomed(m.HWnd) AndAlso pt.Y >= 0 AndAlso pt.Y < edge Then
                If pt.X < edge * 2 Then
                    m.Result = New IntPtr(HT_TOPLEFT)
                ElseIf pt.X >= ClientSize.Width - edge * 2 Then
                    m.Result = New IntPtr(HT_TOPRIGHT)
                Else
                    m.Result = New IntPtr(HT_TOP)
                End If
                Return
            End If
            If TitleBar IsNot Nothing AndAlso pt.Y >= 0 AndAlso pt.Y < TitleBar.Bottom Then
                Dim local As SD.Point = TitleBar.PointToClient(PointToScreen(pt))
                If TitleBar.HitButton(local) = WindowTitleBar.CaptionButton.None Then m.Result = New IntPtr(HT_CAPTION)
            End If
            Return
        End If

        MyBase.WndProc(m)
    End Sub

    ' Toggles <html data-host-sizing> on the page. Fire-and-forget: the
    ' resize must never wait on the renderer.
    Private Sub SetPageSizing(sizing As Boolean)
        If _pageSizing = sizing Then Return
        _pageSizing = sizing
        Try
            Dim core As CoreWebView2 = If(WebView1 IsNot Nothing, WebView1.CoreWebView2, Nothing)
            If core Is Nothing Then Return
            ' The attribute drives the host stylesheet; the event tells the
            ' page's own live-resize controller (and through it the app).
            Dim js As String =
                "(function(on){var h=document.documentElement;" &
                "if(h){if(on)h.setAttribute('data-host-sizing','');else h.removeAttribute('data-host-sizing');}" &
                "try{window.dispatchEvent(new CustomEvent('bc:host-sizing',{detail:{active:on}}));}catch(e){}" &
                "})(" & If(sizing, "true", "false") & ");"
            Dim pending As Task(Of String) = core.ExecuteScriptAsync(js)
        Catch
        End Try
    End Sub

    ' ── OVERSIZED DRAG ────────────────────────────────────────────────
    ' Why the edges used to tear while the window grew: every resize step
    ' makes WebView2 allocate a larger surface, and until the first frame at
    ' that size arrives, the newly uncovered strip along the right/bottom
    ' edge has nothing in it. That wait is inside the browser; the page
    ' can't make it shorter.
    '
    ' So for an edge drag the WebView is made as large as the monitor, once,
    ' on the press, and stays that size until release: the window just
    ' reveals more or less of a surface that is already painted. The page
    ' is asked first (window.__bcHostOversize) and, if it agrees, pins its
    ' layout to the visible size; from then on it is told the visible size
    ' on every step (PostWebMessage {bcHostView:{w,h}}) and follows it, with
    ' no browser resize in between. On release the WebView goes back to the
    ' exact size and the page lets go of the pin once the two agree (it
    ' sees {bcHostView:{..., end:true}}). A page that doesn't answer "true"
    ' (an older page, or a settings window/lightbox open) is resized the
    ' normal way.
    Private _ovState As Integer = 0            ' 0 off, 1 asking the page, 2 oversized
    Private _ovSize As SD.Size = SD.Size.Empty
    Private _ovGen As Integer = 0               ' which press a pending answer belongs to

    ' The part of the client area the WebView normally fills.
    Private Function VisibleWebRect() As SD.Rectangle
        Dim top As Integer = If(TitleBar IsNot Nothing AndAlso TitleBar.Visible, TitleBar.Bottom, 0)
        Return New SD.Rectangle(0, top, Math.Max(1, ClientSize.Width), Math.Max(1, ClientSize.Height - top))
    End Function

    Private Sub PostHostView(isEnd As Boolean)
        Try
            Dim core As CoreWebView2 = If(WebView1 IsNot Nothing, WebView1.CoreWebView2, Nothing)
            If core Is Nothing Then Return
            Dim vis As SD.Rectangle = VisibleWebRect()
            core.PostWebMessageAsJson("{""bcHostView"":{""w"":" & vis.Width.ToString(System.Globalization.CultureInfo.InvariantCulture) &
                                      ",""h"":" & vis.Height.ToString(System.Globalization.CultureInfo.InvariantCulture) &
                                      If(isEnd, ",""end"":true", "") & "}}")
        Catch
        End Try
    End Sub

    Private Async Sub BeginOversize()
        If _ovState <> 0 OrElse WindowState <> SWF.FormWindowState.Normal OrElse WebView1 Is Nothing Then Return
        Dim core As CoreWebView2 = Nothing
        Try
            core = WebView1.CoreWebView2
        Catch
            core = Nothing
        End Try
        If core Is Nothing Then Return
        _ovState = 1
        _ovGen += 1
        Dim gen As Integer = _ovGen
        Dim ok As Boolean = False
        Try
            Dim v0 As SD.Rectangle = VisibleWebRect()
            Dim r As String = Await core.ExecuteScriptAsync(
                "(function(){try{return !!(window.__bcHostOversize&&window.__bcHostOversize(" &
                v0.Width.ToString(System.Globalization.CultureInfo.InvariantCulture) & "," &
                v0.Height.ToString(System.Globalization.CultureInfo.InvariantCulture) & "));}catch(e){return false;}})()")
            ok = (r = "true")
        Catch
            ok = False
        End Try
        ' A newer press has taken over: its own request owns the page's pin.
        If gen <> _ovGen Then Return
        If _ovState <> 1 Then
            ' The drag ended while the page was answering. If it pinned
            ' itself, hand it the final size so it lets go again.
            If ok Then PostHostView(True)
            Return
        End If
        If Not ok Then
            _ovState = 0
            Return
        End If
        Try
            Dim vis As SD.Rectangle = VisibleWebRect()
            Dim scr As SD.Rectangle = SWF.Screen.FromHandle(Handle).Bounds
            _ovSize = New SD.Size(Math.Max(vis.Width, scr.Width), Math.Max(vis.Height, scr.Height))
            _ovState = 2
            WebView1.Dock = SWF.DockStyle.None
            WebView1.SetBounds(vis.X, vis.Y, _ovSize.Width, _ovSize.Height)
            PostHostView(False)
        Catch
            ' Could not resize the view: put it back and release the page.
            _ovState = 0
            Try
                WebView1.Dock = SWF.DockStyle.Fill
            Catch
            End Try
            PostHostView(True)
        End Try
    End Sub

    Private Sub EndOversize()
        Select Case _ovState
            Case 2
                _ovState = 0
                Try
                    WebView1.Dock = SWF.DockStyle.Fill      ' back to exactly the visible area
                Catch
                End Try
                PostHostView(True)
            Case 1
                ' Still waiting for the page's answer; BeginOversize sends the
                ' release itself if the page had pinned.
                _ovState = 0
        End Select
    End Sub

    Protected Overrides Sub OnActivated(e As EventArgs)
        MyBase.OnActivated(e)
        If _winActive Then Return
        _winActive = True
        ApplyWindowFrameColors()
    End Sub

    Protected Overrides Sub OnDeactivate(e As EventArgs)
        MyBase.OnDeactivate(e)
        If Not _winActive Then Return
        _winActive = False
        ApplyWindowFrameColors()
    End Sub

    Protected Overrides Sub OnResize(e As EventArgs)
        MyBase.OnResize(e)
        ' Oversized drag: keep the WebView covering the window (it only grows
        ' further if the window outgrows the monitor) and tell the page the
        ' size that is actually visible.
        If _ovState <> 0 Then
            If _ovState = 2 Then
                Dim vis As SD.Rectangle = VisibleWebRect()
                If vis.Width > _ovSize.Width OrElse vis.Height > _ovSize.Height Then
                    _ovSize = New SD.Size(Math.Max(vis.Width, _ovSize.Width), Math.Max(vis.Height, _ovSize.Height))
                    Try
                        WebView1.SetBounds(vis.X, vis.Y, _ovSize.Width, _ovSize.Height)
                    Catch
                    End Try
                End If
            End If
            PostHostView(False)
        End If
        ' Size changes already repaint the title bar (ResizeRedraw). Only a
        ' maximise / restore needs an extra repaint, for the caption glyph
        ' and the top hairline.
        If WindowState <> _lastWindowState Then
            _lastWindowState = WindowState
            If TitleBar IsNot Nothing Then TitleBar.Invalidate()
        End If
    End Sub

    Protected Overrides Sub OnTextChanged(e As EventArgs)
        MyBase.OnTextChanged(e)
        If TitleBar IsNot Nothing Then TitleBar.Invalidate()
    End Sub

    Private Sub ApplyWindowThemeFromJs(json As JObject)
        Dim accent As SD.Color = _winAccent
        Dim b1 As SD.Color = _winBase1
        Dim c As SD.Color
        If ParseHexColor(JStr(json, "accent"), c) Then accent = c
        If ParseHexColor(JStr(json, "base1"), c) Then b1 = c
        Dim b2 As SD.Color = If(ParseHexColor(JStr(json, "base2"), c), c, b1)
        Dim b3 As SD.Color = If(ParseHexColor(JStr(json, "base3"), c), c, b2)
        ' Older pages don't send "edge": fall back to the average base tone.
        Dim edge As SD.Color = If(ParseHexColor(JStr(json, "edge"), c), c, WinMix(WinMix(b1, b2, 0.5), b3, 2.0 / 3.0))
        ' Nothing changed: no repaint, no DWM / WebView calls.
        If accent.ToArgb() = _winAccent.ToArgb() AndAlso b1.ToArgb() = _winBase1.ToArgb() AndAlso
           b2.ToArgb() = _winBase2.ToArgb() AndAlso b3.ToArgb() = _winBase3.ToArgb() AndAlso
           edge.ToArgb() = _winEdge.ToArgb() Then Return
        _winAccent = accent : _winBase1 = b1 : _winBase2 = b2 : _winBase3 = b3 : _winEdge = edge
        If InvokeRequired Then
            BeginInvoke(New Action(AddressOf ScheduleWindowFrameColors))
        Else
            ScheduleWindowFrameColors()
        End If
    End Sub

    ' Leading + trailing throttle: the first change paints at once, further
    ' changes inside the interval are folded into one paint at its end.
    Private Sub ScheduleWindowFrameColors()
        If IsDisposed Then Return
        If _themeTimer Is Nothing Then
            _themeTimer = New SWF.Timer() With {.Interval = THEME_APPLY_INTERVAL_MS}
            AddHandler _themeTimer.Tick, AddressOf OnThemeTimerTick
        End If
        If _themeTimer.Enabled Then
            _themePending = True
        Else
            ApplyWindowFrameColors()
            _themeTimer.Start()
        End If
    End Sub

    Private Sub OnThemeTimerTick(sender As Object, e As EventArgs)
        If _themePending Then
            _themePending = False
            ApplyWindowFrameColors()                   ' timer keeps running for the next burst
        Else
            _themeTimer.Stop()
        End If
    End Sub

    ' Windows 10 only (see header): a neutral hairline, never the accent.
    Private Function TopHairlineColor() As SD.Color
        Return WinMix(SD.Color.White, _winBase1, If(_winActive, 0.1, 0.06))
    End Function

    Private Sub ApplyWindowFrameColors()
        Try
            ' Title bar: the page's own base tones, a shade deeper so the bar
            ' reads as frame, running left to right the way the page's
            ' background gradient does.
            Dim barLeft As SD.Color = WinMix(_winBase1, SD.Color.Black, 0.8)
            Dim barRight As SD.Color = WinMix(WinMix(_winBase2, _winBase3, 0.5), SD.Color.Black, 0.78)
            ' Setting BackColor re-themes and invalidates the form and every
            ' child, so only do it when the colour really changed.
            If Me.BackColor.ToArgb() <> _winEdge.ToArgb() Then Me.BackColor = _winEdge
            ' What the WebView shows where the page has not painted yet (the
            ' newly exposed strip while the window grows): the page's own
            ' edge colour, so the strip blends in rather than standing apart.
            Try
                If WebView1 IsNot Nothing AndAlso WebView1.DefaultBackgroundColor.ToArgb() <> _winEdge.ToArgb() Then
                    WebView1.DefaultBackgroundColor = _winEdge
                End If
                ' The control's own surface too: for the instant between the
                ' control growing and the browser window inside it following,
                ' that is what shows — and unpainted, it shows black.
                If WebView1 IsNot Nothing AndAlso WebView1.BackColor.ToArgb() <> _winEdge.ToArgb() Then
                    WebView1.BackColor = _winEdge
                End If
            Catch
            End Try
            If TitleBar IsNot Nothing Then TitleBar.SetTheme(barLeft, barRight, _winAccent, TopHairlineColor(), Not _dwmBorderHidden, _winActive)
            SyncLicenseWindowFrame()
        Catch
        End Try
    End Sub

    ' The license test window wears the same border and a caption in the
    ' title bar's colour.
    Private Sub SyncLicenseWindowFrame()
        Try
            If _licWin Is Nothing OrElse _licWin.IsDisposed OrElse Not _licWin.IsHandleCreated Then Return
            Dim border As SD.Color = WinMix(_winAccent, _winBase1, 0.42)
            Dim cap As SD.Color = WinMix(_winBase1, SD.Color.Black, 0.8)
            Dim b As Integer = border.R Or (CInt(border.G) << 8) Or (CInt(border.B) << 16)
            Dim c As Integer = cap.R Or (CInt(cap.G) << 8) Or (CInt(cap.B) << 16)
            DwmSetWindowAttribute(_licWin.Handle, 34, b, 4)
            DwmSetWindowAttribute(_licWin.Handle, 35, c, 4)
        Catch
        End Try
    End Sub

#End Region

#Region "Cleanup"

    ' ── CLOSING WITHOUT LOSING WHAT THE PAGE IS SAVING ─────────────────
    ' Closing the window used to tear the page down 0.6s later, whatever it
    ' was in the middle of. "Mark as paid" and then close straight away cut
    ' off the requests that tell the server the invoice was paid (the list
    ' save, the delivery request), and left a reply the agent had started
    ' half done — so the offline agent never saw the payment and the order
    ' was never sent. Now the window is hidden at once (it still feels
    ' instant), the page is asked to finish (window.bcBeforeClose: its saves
    ' land, it tells the server it's gone), and the app closes when it has,
    ' or after 12 seconds at the most. Windows shutting down, or the app
    ' being killed, doesn't wait.
    Private _closeReady As Boolean = False
    Private _closeStarted As Boolean = False

    Private Async Sub FinishPageThenClose(core As CoreWebView2)
        Try
            Await core.ExecuteScriptAsync(
                "try{window.__bcCloseReady=false;" &
                "Promise.resolve(window.bcBeforeClose?window.bcBeforeClose():null)" &
                ".then(function(){window.__bcCloseReady=true},function(){window.__bcCloseReady=true});" &
                "}catch(e){window.__bcCloseReady=true}")
            Dim deadline As DateTime = DateTime.UtcNow.AddSeconds(12)
            While DateTime.UtcNow < deadline
                Dim r As String = Await core.ExecuteScriptAsync("window.__bcCloseReady===true")
                If r = "true" Then Exit While
                Await Task.Delay(150)
            End While
        Catch
        End Try
        _closeReady = True
        Try
            Me.Close()
        Catch
        End Try
    End Sub

    Protected Overrides Sub OnFormClosing(e As FormClosingEventArgs)
        If Not _closeReady AndAlso e.CloseReason <> SWF.CloseReason.WindowsShutDown AndAlso e.CloseReason <> SWF.CloseReason.TaskManagerClosing Then
            Dim core0 As CoreWebView2 = Nothing
            Try
                core0 = If(WebView1 IsNot Nothing, WebView1.CoreWebView2, Nothing)
            Catch
                core0 = Nothing
            End Try
            If core0 IsNot Nothing Then
                e.Cancel = True
                If Not _closeStarted Then
                    _closeStarted = True
                    Try
                        Me.Hide()
                    Catch
                    End Try
                    FinishPageThenClose(core0)
                End If
                Return
            End If
        End If
        ' Persist peer cache before exit
        If Not String.IsNullOrEmpty(_peerCachePath) AndAlso _peerCache.Count > 0 Then
            Try : SavePeerCacheToDisk() : Catch : End Try
        End If
        If _themeTimer IsNot Nothing Then
            Try
                _themeTimer.Stop()
                _themeTimer.Dispose()
            Catch
            End Try
            _themeTimer = Nothing
        End If
        ' Direct messages: tell the server this app is closing, so offline
        ' agent replies (if turned on) take over straight away instead of
        ' after the presence timeout. A WebView2 being disposed may never fire
        ' the page's own pagehide, hence the explicit call and a short pump
        ' so the request leaves before the process ends.
        Try
            Dim core As CoreWebView2 = If(WebView1 IsNot Nothing, WebView1.CoreWebView2, Nothing)
            If core IsNot Nothing Then
                Dim pending As Task(Of String) = core.ExecuteScriptAsync("try{window.bcGoingAway&&window.bcGoingAway()}catch(e){}")
                Dim waitUntil As DateTime = DateTime.UtcNow.AddMilliseconds(600)
                While DateTime.UtcNow < waitUntil
                    SWF.Application.DoEvents()
                    System.Threading.Thread.Sleep(20)
                End While
            End If
        Catch
        End Try
        DisconnectTelegram()
        CancelDiscordWatchdog()
        Try
            Task.Run(Function() DisconnectDiscord()).Wait(2000)
        Catch
        End Try
        MyBase.OnFormClosing(e)
    End Sub

#End Region

End Class


' ── WindowTitleBar ──────────────────────────────────────────────────────
' The app's own title bar, Discord style: a slim strip in the page's base
' colours with a small accent mark and the window name on the left and
' three flat caption buttons on the right (close turns red on hover).
' Everywhere except the buttons it is transparent to hit-testing, so the
' form answers with HTCAPTION / HTTOP and Windows does the dragging,
' snapping, double-click maximise and top-edge resizing natively.
Public Class WindowTitleBar
    Inherits SWF.Control

    Public Enum CaptionButton
        None = 0
        Minimize = 1
        Maximize = 2
        Close = 3
    End Enum

    Private _left As SD.Color = SD.Color.FromArgb(2, 9, 13)
    Private _right As SD.Color = SD.Color.FromArgb(3, 22, 29)
    Private _accent As SD.Color = SD.Color.FromArgb(139, 143, 163)
    Private _edge As SD.Color = SD.Color.FromArgb(64, 66, 75)
    Private _drawTopEdge As Boolean = False
    Private _active As Boolean = True
    Private _hover As CaptionButton = CaptionButton.None
    Private _down As CaptionButton = CaptionButton.None
    Private ReadOnly _titleFont As SD.Font
    Private ReadOnly _glyphFont As SD.Font
    Private ReadOnly _marlett As Boolean

    Public Sub New()
        SetStyle(SWF.ControlStyles.AllPaintingInWmPaint Or SWF.ControlStyles.OptimizedDoubleBuffer Or
                 SWF.ControlStyles.UserPaint Or SWF.ControlStyles.ResizeRedraw, True)
        SetStyle(SWF.ControlStyles.Selectable, False)
        TabStop = False
        _titleFont = New SD.Font("Segoe UI Semibold", 9.0F, SD.FontStyle.Regular, SD.GraphicsUnit.Point)
        Dim fam As String = PickGlyphFamily()
        _marlett = (fam = "Marlett")
        _glyphFont = New SD.Font(fam, If(_marlett, 8.0F, 7.5F), SD.FontStyle.Regular, SD.GraphicsUnit.Point)
    End Sub

    Private Shared Function PickGlyphFamily() As String
        For Each name As String In New String() {"Segoe Fluent Icons", "Segoe MDL2 Assets"}
            Try
                Using f As New SD.FontFamily(name)
                    Return name
                End Using
            Catch
            End Try
        Next
        Return "Marlett"
    End Function

    Protected Overrides Sub Dispose(disposing As Boolean)
        If disposing Then
            Try : _titleFont.Dispose() : Catch : End Try
            Try : _glyphFont.Dispose() : Catch : End Try
        End If
        MyBase.Dispose(disposing)
    End Sub

    Public Sub SetTheme(left As SD.Color, right As SD.Color, accent As SD.Color, edge As SD.Color, drawTopEdge As Boolean, active As Boolean)
        ' Only repaint when something visible changed.
        If left.ToArgb() = _left.ToArgb() AndAlso right.ToArgb() = _right.ToArgb() AndAlso
           accent.ToArgb() = _accent.ToArgb() AndAlso edge.ToArgb() = _edge.ToArgb() AndAlso
           drawTopEdge = _drawTopEdge AndAlso active = _active Then Return
        _left = left : _right = right : _accent = accent : _edge = edge
        _drawTopEdge = drawTopEdge : _active = active
        Invalidate()
    End Sub

    Private ReadOnly Property UiScale As Double
        Get
            Return Math.Max(1.0, Height / 32.0)
        End Get
    End Property

    Private Function ButtonWidth() As Integer
        Return CInt(Math.Round(Height * 46.0 / 32.0))
    End Function

    Public Function ButtonRect(b As CaptionButton) As SD.Rectangle
        Dim w As Integer = ButtonWidth()
        Select Case b
            Case CaptionButton.Close : Return New SD.Rectangle(Width - w, 0, w, Height)
            Case CaptionButton.Maximize : Return New SD.Rectangle(Width - w * 2, 0, w, Height)
            Case CaptionButton.Minimize : Return New SD.Rectangle(Width - w * 3, 0, w, Height)
        End Select
        Return SD.Rectangle.Empty
    End Function

    Public Function HitButton(pt As SD.Point) As CaptionButton
        If pt.Y < 0 OrElse pt.Y >= Height Then Return CaptionButton.None
        For Each b As CaptionButton In New CaptionButton() {CaptionButton.Minimize, CaptionButton.Maximize, CaptionButton.Close}
            If ButtonRect(b).Contains(pt) Then Return b
        Next
        Return CaptionButton.None
    End Function

    Private Function IsFormMaximized() As Boolean
        Dim f As SWF.Form = FindForm()
        Return f IsNot Nothing AndAlso f.WindowState = SWF.FormWindowState.Maximized
    End Function

    Protected Overrides Sub WndProc(ByRef m As SWF.Message)
        If m.Msg = &H84 Then                                  ' WM_NCHITTEST
            Dim pt As SD.Point = PointToClient(Form1.ScreenPointFromLParam(m.LParam))
            Dim edge As Integer = Math.Max(4, CInt(Math.Round(Height * 6.0 / 32.0)))
            If HitButton(pt) = CaptionButton.None OrElse (Not IsFormMaximized() AndAlso pt.Y < edge) Then
                m.Result = New IntPtr(-1)                    ' HTTRANSPARENT: let the form answer
                Return
            End If
        End If
        MyBase.WndProc(m)
    End Sub

    Protected Overrides Sub OnMouseMove(e As SWF.MouseEventArgs)
        MyBase.OnMouseMove(e)
        Dim h As CaptionButton = HitButton(e.Location)
        If h <> _hover Then _hover = h : Invalidate()
    End Sub

    Protected Overrides Sub OnMouseLeave(e As EventArgs)
        MyBase.OnMouseLeave(e)
        If _hover <> CaptionButton.None OrElse _down <> CaptionButton.None Then
            _hover = CaptionButton.None
            If Not Capture Then _down = CaptionButton.None
            Invalidate()
        End If
    End Sub

    Protected Overrides Sub OnMouseDown(e As SWF.MouseEventArgs)
        MyBase.OnMouseDown(e)
        If e.Button = SWF.MouseButtons.Left Then
            _down = HitButton(e.Location)
            Invalidate()
        End If
    End Sub

    Protected Overrides Sub OnMouseUp(e As SWF.MouseEventArgs)
        MyBase.OnMouseUp(e)
        Dim d As CaptionButton = _down
        _down = CaptionButton.None
        _hover = HitButton(e.Location)
        Invalidate()
        If e.Button <> SWF.MouseButtons.Left OrElse d = CaptionButton.None OrElse d <> _hover Then Return
        Dim f As SWF.Form = FindForm()
        If f Is Nothing Then Return
        Select Case d
            Case CaptionButton.Minimize
                f.WindowState = SWF.FormWindowState.Minimized
            Case CaptionButton.Maximize
                f.WindowState = If(f.WindowState = SWF.FormWindowState.Maximized, SWF.FormWindowState.Normal, SWF.FormWindowState.Maximized)
            Case CaptionButton.Close
                f.Close()
        End Select
    End Sub

    Private Function Glyph(b As CaptionButton) As String
        Dim maxed As Boolean = IsFormMaximized()
        If _marlett Then
            Select Case b
                Case CaptionButton.Minimize : Return "0"
                Case CaptionButton.Maximize : Return If(maxed, "2", "1")
                Case Else : Return "r"
            End Select
        End If
        Select Case b
            Case CaptionButton.Minimize : Return ChrW(&HE921)
            Case CaptionButton.Maximize : Return If(maxed, ChrW(&HE923), ChrW(&HE922))
            Case Else : Return ChrW(&HE8BB)
        End Select
    End Function

    Protected Overrides Sub OnPaint(e As SWF.PaintEventArgs)
        Dim g As SD.Graphics = e.Graphics
        Dim r As SD.Rectangle = ClientRectangle
        If r.Width <= 0 OrElse r.Height <= 0 Then Return
        Dim s As Double = UiScale

        Using br As New SD2.LinearGradientBrush(r, _left, _right, SD2.LinearGradientMode.Horizontal)
            g.FillRectangle(br, r)
        End Using
        Using p As New SD.Pen(SD.Color.FromArgb(If(_active, 16, 10), 255, 255, 255))
            g.DrawLine(p, 0, r.Bottom - 1, r.Right, r.Bottom - 1)
        End Using
        If _drawTopEdge AndAlso Not IsFormMaximized() Then
            Using p As New SD.Pen(_edge)
                g.DrawLine(p, 0, 0, r.Right, 0)
            End Using
        End If

        ' Accent mark + window name.
        Dim x As Integer = CInt(Math.Round(14 * s))
        Dim dot As Integer = Math.Max(5, CInt(Math.Round(6 * s)))
        g.SmoothingMode = SD2.SmoothingMode.AntiAlias
        Using dotBrush As New SD.SolidBrush(If(_active, Form1.WinMix(_accent, _left, 0.9), Form1.WinMix(_accent, _left, 0.35)))
            g.FillEllipse(dotBrush, x, (Height - dot) \ 2, dot, dot)
        End Using
        g.SmoothingMode = SD2.SmoothingMode.Default
        x += dot + CInt(Math.Round(9 * s))
        Dim f As SWF.Form = FindForm()
        Dim title As String = If(f IsNot Nothing, f.Text, "")
        Dim textRight As Integer = ButtonRect(CaptionButton.Minimize).Left - CInt(Math.Round(8 * s))
        If textRight > x Then
            SWF.TextRenderer.DrawText(g, title, _titleFont, New SD.Rectangle(x, 0, textRight - x, Height),
                If(_active, SD.Color.FromArgb(176, 180, 200), SD.Color.FromArgb(104, 108, 128)),
                SWF.TextFormatFlags.Left Or SWF.TextFormatFlags.VerticalCenter Or SWF.TextFormatFlags.EndEllipsis Or
                SWF.TextFormatFlags.NoPrefix Or SWF.TextFormatFlags.SingleLine)
        End If

        ' Caption buttons.
        For Each b As CaptionButton In New CaptionButton() {CaptionButton.Minimize, CaptionButton.Maximize, CaptionButton.Close}
            Dim br2 As SD.Rectangle = ButtonRect(b)
            Dim hot As Boolean = (_hover = b)
            Dim pressed As Boolean = hot AndAlso (_down = b)
            Dim ink As SD.Color = If(_active, SD.Color.FromArgb(160, 164, 186), SD.Color.FromArgb(96, 100, 120))
            If hot AndAlso b = CaptionButton.Close Then
                Using fill As New SD.SolidBrush(If(pressed, SD.Color.FromArgb(186, 45, 50), SD.Color.FromArgb(218, 55, 60)))
                    g.FillRectangle(fill, br2)
                End Using
                ink = SD.Color.White
            ElseIf hot Then
                Using fill As New SD.SolidBrush(SD.Color.FromArgb(If(pressed, 26, 15), 255, 255, 255))
                    g.FillRectangle(fill, br2)
                End Using
                ink = SD.Color.FromArgb(230, 232, 242)
            End If
            SWF.TextRenderer.DrawText(g, Glyph(b), _glyphFont, br2, ink,
                SWF.TextFormatFlags.HorizontalCenter Or SWF.TextFormatFlags.VerticalCenter Or
                SWF.TextFormatFlags.NoPadding Or SWF.TextFormatFlags.NoPrefix Or SWF.TextFormatFlags.SingleLine)
        Next
    End Sub

End Class

' ── IUpdateHandler implementation ───────────────────────────────────────────
Public Class TgUpdateHandler
    Implements Telegram.Bot.Polling.IUpdateHandler

    Private ReadOnly _updateFn As Func(Of ITelegramBotClient, Telegram.Bot.Types.Update, CancellationToken, Task)
    Private ReadOnly _pollingErrorFn As Func(Of ITelegramBotClient, Exception, CancellationToken, Task)

    Public Sub New(
            updateFn As Func(Of ITelegramBotClient, Telegram.Bot.Types.Update, CancellationToken, Task),
            pollingErrorFn As Func(Of ITelegramBotClient, Exception, CancellationToken, Task))
        _updateFn = updateFn
        _pollingErrorFn = pollingErrorFn
    End Sub

    Public Function HandleUpdateAsync(botClient As ITelegramBotClient, update As Telegram.Bot.Types.Update, cancellationToken As CancellationToken) As Task _
            Implements Telegram.Bot.Polling.IUpdateHandler.HandleUpdateAsync
        Return _updateFn(botClient, update, cancellationToken)
    End Function

    Public Function HandlePollingErrorAsync(botClient As ITelegramBotClient, exception As Exception, cancellationToken As CancellationToken) As Task _
            Implements Telegram.Bot.Polling.IUpdateHandler.HandlePollingErrorAsync
        Return _pollingErrorFn(botClient, exception, cancellationToken)
    End Function

End Class