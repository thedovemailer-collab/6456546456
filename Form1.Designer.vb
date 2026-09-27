<Global.Microsoft.VisualBasic.CompilerServices.DesignerGenerated()>
Partial Class Form1
    Inherits System.Windows.Forms.Form

    <System.Diagnostics.DebuggerNonUserCode()>
    Protected Overrides Sub Dispose(ByVal disposing As Boolean)
        Try
            If disposing AndAlso components IsNot Nothing Then
                components.Dispose()
            End If
        Finally
            MyBase.Dispose(disposing)
        End Try
    End Sub

    Private components As System.ComponentModel.IContainer

    <System.Diagnostics.DebuggerStepThrough()>
    Private Sub InitializeComponent()
        Me.WebView1 = New Microsoft.Web.WebView2.WinForms.WebView2()
        Me.TitleBar = New WindowTitleBar()
        CType(Me.WebView1, System.ComponentModel.ISupportInitialize).BeginInit()
        Me.SuspendLayout()
        '
        'WebView1
        '
        Me.WebView1.AllowExternalDrop = True
        Me.WebView1.CreationProperties = Nothing
        Me.WebView1.DefaultBackgroundColor = System.Drawing.Color.FromArgb(CType(CType(2, Byte), Integer), CType(CType(11, Byte), Integer), CType(CType(16, Byte), Integer))
        Me.WebView1.Dock = System.Windows.Forms.DockStyle.Fill
        Me.WebView1.Location = New System.Drawing.Point(0, 32)
        Me.WebView1.Name = "WebView1"
        Me.WebView1.Size = New System.Drawing.Size(1280, 768)
        Me.WebView1.TabIndex = 0
        Me.WebView1.ZoomFactor = 1.0R
        '
        'TitleBar
        '
        Me.TitleBar.Dock = System.Windows.Forms.DockStyle.Top
        Me.TitleBar.Location = New System.Drawing.Point(0, 0)
        Me.TitleBar.Name = "TitleBar"
        Me.TitleBar.Size = New System.Drawing.Size(1280, 32)
        Me.TitleBar.TabIndex = 1
        Me.TitleBar.TabStop = False
        '
        'Form1
        '
        Me.AutoScaleDimensions = New System.Drawing.SizeF(6.0!, 13.0!)
        Me.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font
        Me.BackColor = System.Drawing.Color.FromArgb(CType(CType(2, Byte), Integer), CType(CType(11, Byte), Integer), CType(CType(16, Byte), Integer))
        Me.ClientSize = New System.Drawing.Size(1280, 800)
        Me.Controls.Add(Me.WebView1)
        Me.Controls.Add(Me.TitleBar)
        Me.FormBorderStyle = System.Windows.Forms.FormBorderStyle.Sizable
        Me.MinimumSize = New System.Drawing.Size(420, 600)
        Me.Name = "Form1"
        Me.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen
        Me.Text = "BotCommand"
        CType(Me.WebView1, System.ComponentModel.ISupportInitialize).EndInit()
        Me.ResumeLayout(False)

    End Sub

    Friend WithEvents WebView1 As Microsoft.Web.WebView2.WinForms.WebView2
    Friend WithEvents TitleBar As WindowTitleBar

End Class