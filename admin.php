<?php
// ── booqi — admin console ────────────────────────────────────
// Place beside api.php and index.php. One page with a live view of the
// whole platform: every account and temporary (guest) account, messages
// on every channel, AI usage and what it costs, sales, abuse signals, the
// health of the background workers, and the controls to act on any of it.
//
// SIGN-IN
//   Open admin.php once: with no password set it shows a setup screen that
//   turns the password you pick into a hash. Paste that hash into
//   ADMIN_PASSWORD_HASH below and upload the file again. (ADMIN_PASSWORD
//   takes a plain password instead, if you'd rather; the hash is safer.)
//
// DATABASE
//   Read from api.php in the same folder, so there is nothing to copy. Fill
//   ADMIN_DB only if admin.php lives somewhere else.
//
// AI COSTS
//   api.php records every AI call in bc_llm_usage (tokens in and out, per
//   account). This page prices them with the list in Settings → AI prices,
//   which you can edit. Usage before that api.php update isn't recorded.
//
// BUILT-IN AI
//   Settings → Built-in AI holds an AI key of your own. Accounts can pick
//   it in the app (Connections → AI provider) instead of adding a key.
//   Calls on it are recorded apart (bc_llm_usage.builtin = 1) and are the
//   cost this console shows; what accounts spend on their own keys is only
//   shown when you choose to see it (the switch on the AI page).

const ADMIN_USERNAME      = 'admin';
const ADMIN_PASSWORD_HASH = '$2y$10$0Q96f1H9yZjJXw.MZx9PtuG/NkQ9..269aYXRUyFPvwp1nGsXUALW';          // paste the hash from the setup screen here
const ADMIN_PASSWORD      = '';          // or a plain password (used only when the hash is empty)
const ADMIN_IP_ALLOWLIST  = [];          // e.g. ['203.0.113.7'] — empty = any address may see the sign-in page
const ADMIN_SESSION_HOURS = 12;          // signed out after this long, whatever you're doing
const ADMIN_IDLE_MINUTES  = 120;         // …or after this long without using the console
const ADMIN_APP_URL       = 'BotCommand.html';
const ADMIN_API_FILE      = 'api.php';
const ADMIN_DB            = ['host' => '', 'name' => '', 'user' => '', 'pass' => ''];
const A_SCHEMA_V          = 4;

// ── If something goes wrong, say what ────────────────────────
// A PHP fatal error normally leaves the browser with a blank
// "HTTP ERROR 500". This prints the actual reason instead.
function a_fatal_page(string $msg): void {
    if (!headers_sent()) { http_response_code(500); header('Content-Type: text/html; charset=utf-8'); }
    if (isset($_GET['api'])) { echo json_encode(['error' => 'Console error: ' . $msg]); return; }
    echo '<!doctype html><meta charset="utf-8"><title>Console error</title><body style="font:14px/1.6 system-ui,sans-serif;background:#020b10;color:#eef0f6;padding:40px;max-width:760px">'
       . '<h1 style="font-size:19px;margin:0 0 10px">The console hit an error</h1>'
       . '<p style="color:#9aa3b8;margin:0 0 14px">Send this message to whoever maintains the site:</p>'
       . '<pre style="white-space:pre-wrap;background:#0b1522;border:1px solid #1d2a3b;border-radius:10px;padding:14px;color:#fecdd3">' . htmlspecialchars($msg, ENT_QUOTES, 'UTF-8') . '</pre>'
       . '<p style="color:#66718a">PHP ' . htmlspecialchars(PHP_VERSION) . '</p></body>';
}
set_exception_handler(function ($e) { a_fatal_page(get_class($e) . ': ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')'); });
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        a_fatal_page($e['message'] . ' (' . basename((string)$e['file']) . ':' . $e['line'] . ')');
    }
});
if (PHP_VERSION_ID < 70400) { a_fatal_page('The console needs PHP 7.4 or newer; this server runs ' . PHP_VERSION . '.'); exit; }

// ── Headers ──────────────────────────────────────────────────
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store, max-age=0');
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
@ini_set('display_errors', '0');
error_reporting(E_ALL);
date_default_timezone_set(@date_default_timezone_get() ?: 'UTC');

if (ADMIN_IP_ALLOWLIST && !in_array((string)($_SERVER['REMOTE_ADDR'] ?? ''), ADMIN_IP_ALLOWLIST, true)) {
    http_response_code(404);
    echo 'Not found';
    exit;
}

$A_IS_API = isset($_GET['api']);
function a_json($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
function a_fail(string $msg, int $code = 400): void { a_json(['error' => $msg], $code); }

// ── Database ─────────────────────────────────────────────────
function a_db_conf(): array {
    $c = ADMIN_DB;
    if (($c['name'] ?? '') !== '') return $c;
    $f = __DIR__ . '/' . ADMIN_API_FILE;
    $src = is_readable($f) ? (string)@file_get_contents($f, false, null, 0, 40000) : '';
    foreach (['host', 'name', 'user', 'pass'] as $k) {
        if (preg_match('/\$db_' . $k . '\s*=\s*([\'"])(.*?)\1\s*;/', $src, $m)) $c[$k] = stripcslashes($m[2]);
    }
    return $c;
}
try {
    $cf = a_db_conf();
    if (($cf['name'] ?? '') === '') throw new RuntimeException('Database settings not found. Put admin.php beside api.php, or fill ADMIN_DB at the top of admin.php.');
    $A_PDO = new PDO('mysql:host=' . ($cf['host'] ?: 'localhost') . ';dbname=' . $cf['name'] . ';charset=utf8mb4', (string)$cf['user'], (string)$cf['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Throwable $e) {
    if ($A_IS_API) a_fail('Database connection failed: ' . $e->getMessage(), 500);
    http_response_code(500);
    echo '<!doctype html><meta charset="utf-8"><title>Console</title><body style="font:15px system-ui;background:#020b10;color:#eef0f6;padding:40px">'
       . '<h1 style="font-size:20px">The console can’t reach the database</h1><p style="color:#9aa3b8">' . htmlspecialchars($e->getMessage()) . '</p></body>';
    exit;
}
function a_pdo(): PDO { return $GLOBALS['A_PDO']; }
function a_warn(Throwable $e, string $sql = ''): void {
    $GLOBALS['A_WARN'][] = mb_substr($e->getMessage(), 0, 200);
    error_log('[admin] ' . $e->getMessage() . ($sql ? ' — ' . mb_substr(preg_replace('/\s+/', ' ', $sql), 0, 160) : ''));
}
function a_rows(string $sql, array $p = []): array {
    try { $s = a_pdo()->prepare($sql); $s->execute($p); return $s->fetchAll(); }
    catch (Throwable $e) { a_warn($e, $sql); return []; }
}
function a_row(string $sql, array $p = []): array {
    $r = a_rows($sql, $p);
    return $r ? $r[0] : [];
}
function a_val(string $sql, array $p = [], $def = 0) {
    try { $s = a_pdo()->prepare($sql); $s->execute($p); $v = $s->fetchColumn(); return ($v === false || $v === null) ? $def : $v; }
    catch (Throwable $e) { a_warn($e, $sql); return $def; }
}
function a_exec(string $sql, array $p = []): int {
    $s = a_pdo()->prepare($sql);
    $s->execute($p);
    return $s->rowCount();
}
function a_schema(bool $reset = false): array {
    static $c = null;
    if ($reset) $c = null;
    if ($c !== null) return $c;
    $c = [];
    try {
        foreach (a_pdo()->query("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()")->fetchAll(PDO::FETCH_NUM) as $r) {
            $c[strtolower($r[0])][strtolower($r[1])] = true;
        }
    } catch (Throwable $e) { a_warn($e); }
    return $c;
}
function a_has(string $t): bool { return isset(a_schema()[strtolower($t)]); }
function a_col(string $t, string $c): bool { return isset(a_schema()[strtolower($t)][strtolower($c)]); }
// Column or a stand-in, so a query never breaks on a migration that didn't land.
function a_c(string $t, string $c, string $fallback = 'NULL'): string { return a_col($t, $c) ? $c : $fallback; }
function a_now(): string {
    static $n = null;
    if ($n === null) $n = (string)a_val("SELECT NOW()", [], date('Y-m-d H:i:s'));
    return $n;
}

// ── Schema the console needs ─────────────────────────────────
function a_ensure_schema(): void {
    if ((int)($_SESSION['adm_schema'] ?? 0) === A_SCHEMA_V) return;
    $pdo = a_pdo();
    $ddl = [
        "CREATE TABLE IF NOT EXISTS bc_admin_settings (
            k VARCHAR(60) NOT NULL PRIMARY KEY, v MEDIUMTEXT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS bc_admin_audit (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(40) NOT NULL, target_id INT NULL DEFAULT NULL,
            detail VARCHAR(500) NOT NULL DEFAULT '', ip VARCHAR(64) NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_created (created_at), INDEX idx_target (target_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS bc_admin_notes (
            account_id INT NOT NULL PRIMARY KEY, note TEXT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS bc_llm_usage (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, account_id INT NULL DEFAULT NULL,
            provider VARCHAR(12) NOT NULL, model VARCHAR(80) NOT NULL DEFAULT '', purpose VARCHAR(60) NOT NULL DEFAULT '',
            input_tokens INT NOT NULL DEFAULT 0, output_tokens INT NOT NULL DEFAULT 0, cached_tokens INT NOT NULL DEFAULT 0,
            estimated TINYINT(1) NOT NULL DEFAULT 0, latency_ms INT NOT NULL DEFAULT 0, ok TINYINT(1) NOT NULL DEFAULT 1,
            error VARCHAR(255) NULL DEFAULT NULL, builtin TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_created (created_at), INDEX idx_acc_created (account_id, created_at), INDEX idx_builtin_created (builtin, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS bc_rate (
            k VARCHAR(100) NOT NULL PRIMARY KEY, win_start INT NOT NULL DEFAULT 0, n INT NOT NULL DEFAULT 0, INDEX idx_win (win_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ];
    foreach ($ddl as $q) { try { $pdo->exec($q); } catch (Throwable $e) { a_warn($e, $q); } }
    a_schema(true);
    // Calls on the built-in AI are told apart from calls on accounts' own keys.
    if (a_has('bc_llm_usage') && !a_col('bc_llm_usage', 'builtin')) {
        try { $pdo->exec("ALTER TABLE bc_llm_usage ADD COLUMN builtin TINYINT(1) NOT NULL DEFAULT 0, ADD INDEX idx_builtin_created (builtin, created_at)"); } catch (Throwable $e) { a_warn($e); }
    }
    if (a_has('bc_accounts')) {
        $add = [
            'suspended_at'   => 'TIMESTAMP NULL DEFAULT NULL',
            'suspend_reason' => 'VARCHAR(255) NULL DEFAULT NULL',
            'last_seen_at'   => 'TIMESTAMP NULL DEFAULT NULL',
        ];
        foreach ($add as $c => $def) {
            if (!a_col('bc_accounts', $c)) { try { $pdo->exec("ALTER TABLE bc_accounts ADD COLUMN $c $def"); } catch (Throwable $e) { a_warn($e); } }
        }
    }
    a_schema(true);
    $_SESSION['adm_schema'] = A_SCHEMA_V;
}

// ── Session & sign-in ────────────────────────────────────────
$A_HTTPS = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
function a_cookie_path(): string {
    $d = str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/')));
    return rtrim($d, '/') . '/';
}
session_name('bq_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => a_cookie_path(), 'secure' => $A_HTTPS, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

function a_ip(): string { return (string)($_SERVER['REMOTE_ADDR'] ?? ''); }
function a_ua_hash(): string { return substr(hash('sha256', (string)($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 16); }
function a_password_set(): bool { return ADMIN_PASSWORD_HASH !== '' || ADMIN_PASSWORD !== ''; }
function a_authed(): bool {
    $s = $_SESSION['adm'] ?? null;
    if (!is_array($s) || empty($s['ok'])) return false;
    $now = time();
    if ($now - (int)$s['at'] > ADMIN_SESSION_HOURS * 3600) return false;
    if ($now - (int)$s['seen'] > ADMIN_IDLE_MINUTES * 60) return false;
    if (!hash_equals((string)$s['ua'], a_ua_hash())) return false;
    // Changing the password in this file signs every console session out.
    if (!hash_equals((string)$s['pv'], a_pw_version())) return false;
    return true;
}
function a_pw_version(): string { return substr(hash('sha256', ADMIN_USERNAME . '|' . ADMIN_PASSWORD_HASH . '|' . ADMIN_PASSWORD), 0, 16); }
function a_csrf(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
    return (string)$_SESSION['csrf'];
}
function a_rate_key(): string { return 'adm:' . substr(hash('sha256', 'booqi-admin|' . a_ip()), 0, 40); }
function a_login_blocked(): int {
    try {
        $r = a_row("SELECT win_start, n FROM bc_rate WHERE k=?", [a_rate_key()]);
        if ($r && (int)$r['win_start'] > time() - 900 && (int)$r['n'] >= 8) return (int)$r['win_start'] + 900 - time();
    } catch (Throwable $e) {}
    return 0;
}
function a_login_fail(): void {
    $now = time();
    try {
        a_exec("INSERT INTO bc_rate (k, win_start, n) VALUES (?,?,1) ON DUPLICATE KEY UPDATE n = IF(win_start <= ?, 1, n + 1), win_start = IF(win_start <= ?, ?, win_start)",
               [a_rate_key(), $now, $now - 900, $now - 900, $now]);
    } catch (Throwable $e) {}
}
function a_audit(string $action, ?int $target, string $detail = ''): void {
    try { a_exec("INSERT INTO bc_admin_audit (action, target_id, detail, ip) VALUES (?,?,?,?)", [$action, $target, mb_substr($detail, 0, 500), a_ip()]); }
    catch (Throwable $e) { a_warn($e); }
}

// Setup screen: turns a chosen password into the hash to paste in.
$A_SETUP_HASH = '';
$A_LOGIN_ERR = '';
if (!a_password_set()) {
    if ($A_IS_API) a_fail('Set an admin password first (open admin.php in your browser).', 401);
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && isset($_POST['setup_pw'])) {
        $pw = (string)$_POST['setup_pw'];
        if (strlen($pw) < 12) $A_LOGIN_ERR = 'Use at least 12 characters.';
        elseif ($pw !== (string)($_POST['setup_pw2'] ?? '')) $A_LOGIN_ERR = 'The two passwords don’t match.';
        else $A_SETUP_HASH = password_hash($pw, PASSWORD_DEFAULT);
    }
    $A_VIEW = 'setup';
} else {
    if (isset($_GET['logout'])) {
        if (a_authed()) a_audit('logout', null);
        $_SESSION = [];
        session_regenerate_id(true);
        header('Location: ' . strtok((string)$_SERVER['REQUEST_URI'], '?'));
        exit;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && isset($_POST['login_user']) && !$A_IS_API) {
        a_ensure_schema();
        $wait = a_login_blocked();
        if (!hash_equals(a_csrf(), (string)($_POST['csrf'] ?? ''))) {
            $A_LOGIN_ERR = 'The page expired. Please try again.';
        } elseif ($wait > 0) {
            $A_LOGIN_ERR = 'Too many attempts. Try again in ' . max(1, (int)ceil($wait / 60)) . ' min.';
        } else {
            $u = (string)$_POST['login_user'];
            $p = (string)($_POST['login_pass'] ?? '');
            $good = hash_equals(ADMIN_USERNAME, $u) && (ADMIN_PASSWORD_HASH !== '' ? password_verify($p, ADMIN_PASSWORD_HASH) : hash_equals(ADMIN_PASSWORD, $p));
            if ($good) {
                session_regenerate_id(true);
                $_SESSION['adm'] = ['ok' => 1, 'at' => time(), 'seen' => time(), 'ua' => a_ua_hash(), 'pv' => a_pw_version()];
                $_SESSION['csrf'] = bin2hex(random_bytes(24));
                a_audit('login', null, 'Signed in');
                header('Location: ' . strtok((string)$_SERVER['REQUEST_URI'], '?'));
                exit;
            }
            a_login_fail();
            if (function_exists('usleep')) usleep(random_int(250000, 600000));
            $A_LOGIN_ERR = 'That username or password isn’t right.';
        }
    }
    $A_VIEW = a_authed() ? 'app' : 'login';
}
if ($A_VIEW === 'app') {
    $_SESSION['adm']['seen'] = time();
    a_ensure_schema();
}

// ── Settings ─────────────────────────────────────────────────
function a_setting(string $k, $def = null) {
    static $all = null;
    if ($all === null) {
        $all = [];
        foreach (a_rows("SELECT k, v FROM bc_admin_settings") as $r) $all[$r['k']] = $r['v'];
    }
    if (!array_key_exists($k, $all)) return $def;
    $j = json_decode((string)$all[$k], true);
    return $j === null && $all[$k] !== 'null' ? $all[$k] : $j;
}
function a_setting_set(string $k, $v): void {
    a_exec("INSERT INTO bc_admin_settings (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)",
           [$k, is_string($v) ? $v : json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}

// ── AI prices (USD per 1M tokens: input, cached input, output) ─
// List prices when this was written. Edit them in Settings; your edits
// are what every figure on this page uses.
const A_DEFAULT_PRICES = [
    'gemini-2.5-flash'          => ['gemini', 0.30, 0.075, 2.50],
    'gemini-2.5-flash-lite'     => ['gemini', 0.10, 0.025, 0.40],
    'gemini-2.5-pro'            => ['gemini', 1.25, 0.31, 10.00],
    'gemini-3.1-flash'          => ['gemini', 0.50, 0.125, 3.00],
    'gemini-3.1-pro-preview'    => ['gemini', 2.00, 0.50, 12.00],
    'gpt-4o-mini'               => ['openai', 0.15, 0.075, 0.60],
    'gpt-4o'                    => ['openai', 2.50, 1.25, 10.00],
    'gpt-4.1-mini'              => ['openai', 0.40, 0.10, 1.60],
    'gpt-4.1'                   => ['openai', 2.00, 0.50, 8.00],
    'gpt-5-mini'                => ['openai', 0.25, 0.025, 2.00],
    'gpt-5'                     => ['openai', 1.25, 0.125, 10.00],
    'claude-haiku-4-5-20251001' => ['claude', 1.00, 0.10, 5.00],
    'claude-sonnet-4-6'         => ['claude', 3.00, 0.30, 15.00],
    'claude-opus-4-6'           => ['claude', 5.00, 0.50, 25.00],
    'claude-opus-4-7'           => ['claude', 5.00, 0.50, 25.00],
];
const A_PROVIDER_FALLBACK = ['gemini' => [0.30, 0.075, 2.50], 'openai' => [0.40, 0.10, 1.60], 'claude' => [3.00, 0.30, 15.00]];
function a_prices(): array {
    static $p = null;
    if ($p !== null) return $p;
    $p = [];
    foreach (A_DEFAULT_PRICES as $m => $v) $p[$m] = ['provider' => $v[0], 'in' => $v[1], 'cached' => $v[2], 'out' => $v[3]];
    $saved = a_setting('llm_prices');
    if (is_array($saved)) {
        foreach ($saved as $m => $v) {
            if (!is_array($v)) continue;
            if (!empty($v['deleted'])) { unset($p[$m]); continue; }
            $p[(string)$m] = ['provider' => (string)($v['provider'] ?? 'gemini'), 'in' => (float)($v['in'] ?? 0), 'cached' => (float)($v['cached'] ?? 0), 'out' => (float)($v['out'] ?? 0)];
        }
    }
    return $p;
}
function a_price_for(string $model, string $provider): array {
    $p = a_prices();
    if (isset($p[$model])) return $p[$model];
    $best = null; $len = 0;
    foreach ($p as $m => $v) if ($m !== '' && strpos($model, $m) === 0 && strlen($m) > $len) { $best = $v; $len = strlen($m); }
    if ($best) return $best;
    $f = A_PROVIDER_FALLBACK[$provider] ?? [1, 0.1, 5];
    return ['provider' => $provider, 'in' => $f[0], 'cached' => $f[1], 'out' => $f[2], 'guess' => true];
}
function a_cost(string $model, string $provider, float $in, float $cached, float $out): float {
    $pr = a_price_for($model, $provider);
    $cached = min($cached, $in);
    return (($in - $cached) * $pr['in'] + $cached * $pr['cached'] + $out * $pr['out']) / 1e6;
}

// ── Built-in AI ──────────────────────────────────────────────
// Your own AI key, offered to every account (api.php reads these settings;
// the key itself never goes back to a browser, this page's included).
const A_PROVIDERS = ['gemini', 'openai', 'claude'];
function a_builtin(): array {
    $pv = (string)a_setting('builtin_llm_provider', 'gemini');
    if (!in_array($pv, A_PROVIDERS, true)) $pv = 'gemini';
    $model = (string)a_setting('builtin_llm_model', '');
    if ($model === '') foreach (a_prices() as $m => $v) { if ($v['provider'] === $pv) { $model = $m; break; } }
    $key = (string)a_setting('builtin_llm_key', '');
    return ['on' => (string)a_setting('builtin_llm_on', '0') === '1', 'provider' => $pv, 'model' => $model,
            'has_key' => $key !== '', 'key_hint' => $key === '' ? '' : '••••' . substr($key, -4)];
}
// Accounts that chose the built-in AI in the app.
function a_builtin_users(): int {
    return (int)a_val("SELECT COUNT(DISTINCT account_id) FROM bc_credentials WHERE `key`='llm_active' AND value='builtin'");
}
// Whose AI costs the console counts: 'builtin' (calls on your built-in AI —
// the default), 'own' (calls on accounts' own keys) or 'all'.
function a_ai_scope(): string {
    $s = (string)a_setting('ai_scope', 'builtin');
    return in_array($s, ['builtin', 'own', 'all'], true) ? $s : 'builtin';
}
// SQL condition on bc_llm_usage for that scope.
function a_llm_where(?string $scope = null, string $alias = ''): string {
    $s = $scope ?? a_ai_scope();
    if ($s === 'all') return '1=1';
    if (!a_col('bc_llm_usage', 'builtin')) return $s === 'own' ? '1=1' : '0=1';   // nothing was on the built-in AI yet
    return $alias . 'builtin' . ($s === 'own' ? '=0' : '=1');
}

// ── Money ────────────────────────────────────────────────────
// Sales are recorded in whatever currency the seller priced in. These rates
// turn them into one USD figure; edit them in Settings.
const A_DEFAULT_FX = ['USD' => 1, 'USDT' => 1, 'USDC' => 1, 'EUR' => 1.08, 'GBP' => 1.27, 'CAD' => 0.73, 'AUD' => 0.66, 'NZD' => 0.60, 'CHF' => 1.12, 'JPY' => 0.0067, 'INR' => 0.012];
function a_fx(): array {
    static $fx = null;
    if ($fx !== null) return $fx;
    $s = a_setting('fx_rates');
    if (!is_array($s)) return $fx = A_DEFAULT_FX;      // saved rates replace the defaults entirely
    $fx = [];
    foreach ($s as $k => $v) if (is_numeric($v) && (float)$v > 0) $fx[strtoupper((string)$k)] = (float)$v;
    return $fx;
}
function a_amount($raw): ?float {
    $s = trim((string)$raw);
    if ($s === '') return null;
    $s = preg_replace('/[^0-9.,\-]/', '', $s);
    if ($s === '' || $s === '-') return null;
    if (strpos($s, '.') !== false) $s = str_replace(',', '', $s);
    elseif (substr_count($s, ',') === 1 && preg_match('/,\d{1,2}$/', $s)) $s = str_replace(',', '.', $s);
    else $s = str_replace(',', '', $s);
    return is_numeric($s) ? (float)$s : null;
}
function a_usd($amount, $cur): ?float {
    $a = a_amount($amount);
    if ($a === null) return null;
    $c = strtoupper(trim((string)$cur)) ?: 'USD';
    $fx = a_fx();
    return isset($fx[$c]) ? $a * $fx[$c] : null;
}

// ── Time ranges ──────────────────────────────────────────────
function a_range(?string $r): array {
    $map = ['24h' => 1, '7d' => 7, '30d' => 30, '90d' => 90, '365d' => 365];
    $key = isset($map[(string)$r]) ? (string)$r : '30d';
    $days = $map[$key];
    $now = strtotime(a_now());
    $hourly = $key === '24h';
    $buckets = [];
    if ($hourly) {
        $start = strtotime(date('Y-m-d H:00:00', $now)) - 23 * 3600;
        for ($i = 0; $i < 24; $i++) $buckets[] = date('Y-m-d H:00', $start + $i * 3600);
    } else {
        $start = strtotime(date('Y-m-d 00:00:00', $now)) - ($days - 1) * 86400;
        for ($i = 0; $i < $days; $i++) $buckets[] = date('Y-m-d', strtotime("+$i day", $start));
    }
    return ['key' => $key, 'days' => $days, 'hourly' => $hourly, 'from' => date('Y-m-d H:i:s', $start), 'buckets' => $buckets];
}
function a_b(string $col, array $r): string {
    return $r['hourly'] ? "DATE_FORMAT($col, '%Y-%m-%d %H:00')" : "DATE($col)";
}
function a_fill(array $r, array $map, $zero = 0): array {
    $out = [];
    foreach ($r['buckets'] as $b) $out[] = $map[$b] ?? $zero;
    return $out;
}
function a_ago_sql(int $sec): string { return date('Y-m-d H:i:s', strtotime(a_now()) - $sec); }
function a_today(): string { return date('Y-m-d 00:00:00', strtotime(a_now())); }

// Direct-chat messages have no index on created_at, but ids only ever
// grow, so the first id at or after a moment is found by a binary search
// on the primary key (a couple of dozen point lookups).
function a_dm_id_since(string $when): int {
    static $memo = [];
    if (isset($memo[$when])) return $memo[$when];
    if (!a_has('bc_dm_messages')) return $memo[$when] = PHP_INT_MAX;
    $mm = a_row("SELECT MIN(id) lo, MAX(id) hi FROM bc_dm_messages");
    if (!$mm || $mm['hi'] === null) return $memo[$when] = PHP_INT_MAX;
    $lo = (int)$mm['lo']; $hi = (int)$mm['hi'] + 1;
    $q = a_pdo()->prepare("SELECT id, created_at FROM bc_dm_messages WHERE id >= ? ORDER BY id LIMIT 1");
    for ($i = 0; $i < 64 && $lo < $hi; $i++) {
        $mid = intdiv($lo + $hi, 2);
        $q->execute([$mid]);
        $r = $q->fetch();
        if (!$r || (string)$r['created_at'] >= $when) $hi = $mid;
        else $lo = (int)$r['id'] + 1;
    }
    return $memo[$when] = $lo;
}

// ── Shared account data ──────────────────────────────────────
function a_acc_cols(string $p = ''): string {
    $t = 'bc_accounts';
    $c = function (string $col, string $fb = 'NULL') use ($t, $p) { return (a_col($t, $col) ? $p . $col : $fb) . " AS $col"; };
    return "{$p}id AS id, {$p}email AS email, {$p}username AS username, {$p}display_name AS display_name, {$p}created_at AS created_at, {$p}last_login AS last_login, "
         . implode(', ', [$c('is_guest', '0'), $c('guest_of'), $c('claimed_at'), $c('suspended_at'), $c('suspend_reason'), $c('last_seen_at'), $c('guest_ip')]);
}
function a_accounts_all(): array {
    static $all = null;
    if ($all !== null) return $all;
    $all = [];
    foreach (a_rows("SELECT " . a_acc_cols() . " FROM bc_accounts") as $r) $all[(int)$r['id']] = $r;
    $dm = a_has('bc_dm_profile') && a_col('bc_dm_profile', 'last_seen')
        ? a_rows("SELECT account_id, last_seen FROM bc_dm_profile WHERE last_seen IS NOT NULL") : [];
    foreach ($dm as $d) if (isset($all[(int)$d['account_id']])) $all[(int)$d['account_id']]['dm_seen'] = $d['last_seen'];
    foreach ($all as $id => $r) {
        $seen = max((string)($r['last_seen_at'] ?? ''), (string)($r['last_login'] ?? ''), (string)($r['dm_seen'] ?? ''));
        $all[$id]['seen'] = $seen ?: null;
    }
    return $all;
}
function a_acc_brief(?array $r): ?array {
    if (!$r) return null;
    return [
        'id' => (int)$r['id'], 'username' => (string)$r['username'], 'name' => (string)($r['display_name'] ?: $r['username']),
        'email' => !empty($r['is_guest']) ? '' : (string)$r['email'], 'guest' => !empty($r['is_guest']),
        'suspended' => !empty($r['suspended_at']), 'created' => $r['created_at'], 'seen' => $r['seen'] ?? $r['last_login'] ?? null,
    ];
}
function a_name_of(int $id): string {
    if ($id <= 0) return 'Unattributed';
    $a = a_accounts_all()[$id] ?? null;
    return $a ? (string)($a['display_name'] ?: $a['username']) : ('#' . $id);
}

// Messages per account since $from: [acc => [n, in, ai, dm_sent, dm_recv, dm_ai]]
function a_msg_by_account(string $from): array {
    $out = [];
    if (a_has('bc_messages')) {
        $agent = a_col('bc_messages', 'agent_name') ? "SUM(role<>'in' AND agent_name<>'')" : "0";
        foreach (a_rows("SELECT account_id a, COUNT(*) n, SUM(role='in') i, $agent ai FROM bc_messages
                          WHERE created_at >= ? AND LEFT(conv_id,3) <> 'dm_' AND account_id IS NOT NULL GROUP BY account_id", [$from]) as $r) {
            $out[(int)$r['a']] = ['n' => (int)$r['n'], 'in' => (int)$r['i'], 'ai' => (int)$r['ai'], 'dm_sent' => 0, 'dm_recv' => 0, 'dm_ai' => 0];
        }
    }
    if (a_has('bc_dm_messages')) {
        $id = a_dm_id_since($from);
        $ai = a_col('bc_dm_messages', 'ai_agent') ? "SUM(ai_agent<>0)" : "0";
        $z = ['n' => 0, 'in' => 0, 'ai' => 0, 'dm_sent' => 0, 'dm_recv' => 0, 'dm_ai' => 0];
        foreach (a_rows("SELECT sender_id a, COUNT(*) n, $ai ai FROM bc_dm_messages WHERE id >= ? GROUP BY sender_id", [$id]) as $r) {
            $a = (int)$r['a']; $out[$a] = ($out[$a] ?? $z);
            $out[$a]['dm_sent'] = (int)$r['n']; $out[$a]['dm_ai'] = (int)$r['ai'];
        }
        foreach (a_rows("SELECT recipient_id a, COUNT(*) n FROM bc_dm_messages WHERE id >= ? GROUP BY recipient_id", [$id]) as $r) {
            $a = (int)$r['a']; $out[$a] = ($out[$a] ?? $z);
            $out[$a]['dm_recv'] = (int)$r['n'];
        }
    }
    return $out;
}

// AI usage per account since $from: [acc => [calls, errors, in, out, cost, lat]]
function a_llm_by_account(string $from): array {
    $out = [];
    if (!a_has('bc_llm_usage')) return $out;
    foreach (a_rows("SELECT account_id a, provider, model, COUNT(*) calls, SUM(ok=0) errs, SUM(input_tokens) i, SUM(cached_tokens) c,
                            SUM(output_tokens) o, SUM(latency_ms) lat
                       FROM bc_llm_usage WHERE created_at >= ? AND " . a_llm_where() . " GROUP BY account_id, provider, model", [$from]) as $r) {
        $a = (int)$r['a'];
        $o = $out[$a] ?? ['calls' => 0, 'errors' => 0, 'in' => 0, 'out' => 0, 'cost' => 0.0, 'lat' => 0, 'models' => []];
        $cost = a_cost((string)$r['model'], (string)$r['provider'], (float)$r['i'], (float)$r['c'], (float)$r['o']);
        $o['calls'] += (int)$r['calls']; $o['errors'] += (int)$r['errs'];
        $o['in'] += (int)$r['i']; $o['out'] += (int)$r['o']; $o['cost'] += $cost; $o['lat'] += (int)$r['lat'];
        $o['models'][(string)$r['model']] = ($o['models'][(string)$r['model']] ?? 0) + (int)$r['calls'];
        $out[$a] = $o;
    }
    return $out;
}

// Completed sales since $from (null = all time), each with a USD figure.
function a_sales_rows(?string $from = null, ?int $acc = null, int $limit = 0): array {
    if (!a_has('bc_end_user_transactions')) return [];
    $w = []; $p = [];
    if ($from) { $w[] = 't.created_at >= ?'; $p[] = $from; }
    if ($acc)  { $w[] = 't.account_id = ?'; $p[] = $acc; }
    $sql = "SELECT t.id, t.account_id, t.end_user_id, t.product_id, t.amount, t.currency, t.status, t.reference, t.created_at,
                   p.name AS product, u.name AS customer, u.platform AS channel
              FROM bc_end_user_transactions t
              LEFT JOIN bc_products p ON p.id = t.product_id
              LEFT JOIN bc_end_users u ON u.id = t.end_user_id"
         . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY t.id DESC' . ($limit ? ' LIMIT ' . (int)$limit : '');
    $rows = a_rows($sql, $p);
    foreach ($rows as &$r) {
        $r['usd'] = a_usd($r['amount'], $r['currency']);
        $r['paid'] = in_array(strtolower((string)$r['status']), ['completed', 'complete', 'paid', 'confirmed'], true);
    }
    return $rows;
}
function a_sales_by_account(?string $from = null): array {
    $o = [];
    foreach (a_sales_rows($from) as $r) {
        if (!$r['paid']) continue;
        $a = (int)$r['account_id'];
        $o[$a] = $o[$a] ?? ['usd' => 0.0, 'n' => 0, 'other' => 0];
        $o[$a]['n']++;
        if ($r['usd'] !== null) $o[$a]['usd'] += $r['usd']; else $o[$a]['other']++;
    }
    return $o;
}

// Every account's invoice list (kept as JSON in bc_credentials).
function a_invoices(?string $from = null, ?int $acc = null): array {
    if (!a_has('bc_credentials')) return [];
    $fromTs = $from ? strtotime($from) : 0;
    $sql = "SELECT account_id, meta FROM bc_credentials WHERE `key`='payments_invoices'" . ($acc ? " AND account_id=?" : '');
    $out = [];
    foreach (a_rows($sql, $acc ? [$acc] : []) as $r) {
        $list = json_decode((string)$r['meta'], true);
        if (!is_array($list)) continue;
        foreach ($list as $inv) {
            if (!is_array($inv)) continue;
            $t = (int)($inv['created'] ?? 0);
            if ($t > 20000000000) $t = intdiv($t, 1000);   // stored in ms by some clients
            if ($fromTs && $t < $fromTs) continue;
            $st = strtolower((string)($inv['status'] ?? 'pending'));
            if (in_array($st, ['paid', 'completed', 'complete'], true)) $st = 'confirmed';
            $out[] = [
                'account_id' => (int)$r['account_id'], 'id' => (string)($inv['id'] ?? ''), 'created' => $t,
                'status' => $st, 'coin' => strtoupper((string)($inv['coin'] ?? '')),
                'fiat' => (string)($inv['fiat'] ?? 'USD'), 'amount' => (string)($inv['amount_fiat'] ?? ''),
                'usd' => a_usd($inv['amount_fiat'] ?? '', $inv['fiat'] ?? 'USD'),
                'desc' => mb_substr((string)($inv['description'] ?? ''), 0, 120),
                'agent' => (string)($inv['agent_name'] ?? ''), 'origin' => (string)($inv['origin'] ?? ''),
                'conv_id' => (string)($inv['conv_id'] ?? ''),
            ];
        }
    }
    return $out;
}

// ── Risk engine ──────────────────────────────────────────────
// Signals that an account (or guest) is being used for spam or abuse.
// Each adds points; the reasons are shown beside the score.
const A_DISPOSABLE = ['mailinator.com','guerrillamail.com','guerrillamail.net','sharklasers.com','10minutemail.com','10minutemail.net','tempmail.com','temp-mail.org','temp-mail.io',
    'yopmail.com','yopmail.net','trashmail.com','trashmail.de','getnada.com','nada.email','dispostable.com','maildrop.cc','mintemail.com','throwawaymail.com','fakeinbox.com',
    'mailnesia.com','mohmal.com','emailondeck.com','tempinbox.com','spamgourmet.com','mytemp.email','tempr.email','discard.email','burnermail.io','moakt.com','tmail.ws',
    'tempmailo.com','inboxkitten.com','mail.tm','mailpoof.com','linshiyouxiang.net','emailfake.com','fakemail.net','spam4.me','grr.la','byom.de','33mail.com','tmpmail.org','tmpmail.net'];
function a_email_disposable(string $email): bool {
    $d = strtolower(substr(strrchr($email, '@') ?: '', 1));
    if ($d === '') return false;
    foreach (A_DISPOSABLE as $x) if ($d === $x || substr($d, -strlen($x) - 1) === '.' . $x) return true;
    return false;
}
function a_username_random(string $u): bool {
    $u = strtolower($u);
    if (preg_match('/^guest-/', $u)) return false;
    if (preg_match('/\d{5,}/', $u)) return true;
    if (preg_match('/[bcdfghjklmnpqrstvwxz]{6,}/', $u)) return true;
    $letters = preg_replace('/[^a-z]/', '', $u);
    return strlen($letters) >= 9 && !preg_match('/[aeiouy]/', $letters);
}
function a_risk_all(): array {
    static $memo = null;
    if ($memo !== null) return $memo;
    $accs = a_accounts_all();
    $sig = [];
    $add = function (int $a, int $pts, string $why, string $kind) use (&$sig) {
        $sig[$a][] = ['pts' => $pts, 'why' => $why, 'kind' => $kind];
    };
    // Sign-up address shared by many accounts (a keyed hash — the address itself is never stored).
    $ipc = [];
    foreach ($accs as $a) if (!empty($a['guest_ip'])) $ipc[$a['guest_ip']] = ($ipc[$a['guest_ip']] ?? 0) + 1;
    $now = strtotime(a_now());
    foreach ($accs as $id => $a) {
        $n = !empty($a['guest_ip']) ? ($ipc[$a['guest_ip']] ?? 1) : 1;
        if ($n >= 8)      $add($id, 30, "Same sign-up address as " . ($n - 1) . " other accounts", 'cluster');
        elseif ($n >= 3)  $add($id, 15, "Same sign-up address as " . ($n - 1) . " other accounts", 'cluster');
        if (empty($a['is_guest']) && a_email_disposable((string)$a['email'])) $add($id, 25, 'Disposable email address', 'email');
        if (empty($a['is_guest']) && a_username_random((string)$a['username'])) $add($id, 10, 'Random-looking username', 'name');
    }
    // Blocked by the people they wrote to.
    if (a_has('bc_dm_threads')) {
        foreach (a_rows("SELECT acc, SUM(n) n FROM (
                            SELECT b_id acc, SUM(a_blocked) n FROM bc_dm_threads WHERE a_blocked=1 GROUP BY b_id
                            UNION ALL SELECT a_id acc, SUM(b_blocked) n FROM bc_dm_threads WHERE b_blocked=1 GROUP BY a_id) x GROUP BY acc") as $r) {
            $n = (int)$r['n'];
            if ($n > 0) $add((int)$r['acc'], min(36, 12 * $n), "Blocked by $n " . ($n === 1 ? 'person' : 'people'), 'blocked');
        }
    }
    // Tripped the agents' spam detection in someone's direct chat.
    if (a_has('bc_dm_ai') && a_col('bc_dm_ai', 'spam_hits') && a_has('bc_dm_threads')) {
        foreach (a_rows("SELECT IF(t.a_id = d.account_id, t.b_id, t.a_id) peer, SUM(d.spam_hits) h
                           FROM bc_dm_ai d JOIN bc_dm_threads t ON t.id = d.thread_id
                          WHERE d.spam_hits > 0 GROUP BY peer") as $r) {
            $h = (int)$r['h'];
            $add((int)$r['peer'], min(40, 10 * $h), "Flagged as spam by an agent $h " . ($h === 1 ? 'time' : 'times'), 'spam');
        }
    }
    // Running close to the message / AI limits right now.
    $lim = ['gm:m' => 10, 'gm:h' => 120, 'gm:d' => 400, 'ga:h' => 15, 'ga:d' => 60];
    $win = ['m' => 60, 'h' => 3600, 'd' => 86400];
    if (a_has('bc_rate')) {
        foreach (a_rows("SELECT k, win_start, n FROM bc_rate WHERE (k LIKE 'gm:%' OR k LIKE 'ga:%') AND win_start > ?", [time() - 86400]) as $r) {
            if (!preg_match('/^(gm|ga):(\d+):([mhd])$/', (string)$r['k'], $m)) continue;
            if ((int)$r['win_start'] <= time() - $win[$m[3]]) continue;
            $max = $lim[$m[1] . ':' . $m[3]] ?? 0;
            if ($max && (int)$r['n'] >= 0.8 * $max) {
                $add((int)$m[2], 15, ($m[1] === 'gm' ? 'Near the message limit' : 'Near the AI reply limit') . ' (' . (int)$r['n'] . '/' . $max . ' per ' . ['m' => 'minute', 'h' => 'hour', 'd' => 'day'][$m[3]] . ')', 'rate');
            }
        }
    }
    // Messages sent with no answers coming back (last 7 days).
    if (a_has('bc_dm_messages')) {
        $id = a_dm_id_since(a_ago_sql(7 * 86400));
        $sent = []; $recv = [];
        foreach (a_rows("SELECT sender_id a, COUNT(*) n FROM bc_dm_messages WHERE id >= ? GROUP BY sender_id HAVING n >= 40", [$id]) as $r) $sent[(int)$r['a']] = (int)$r['n'];
        if ($sent) {
            $in = implode(',', array_map('intval', array_keys($sent)));
            foreach (a_rows("SELECT recipient_id a, COUNT(*) n FROM bc_dm_messages WHERE id >= ? AND recipient_id IN ($in) GROUP BY recipient_id", [$id]) as $r) $recv[(int)$r['a']] = (int)$r['n'];
            foreach ($sent as $a => $n) if (($recv[$a] ?? 0) === 0) $add($a, 15, "Sent $n messages this week with no replies", 'silence');
        }
    }
    // AI use: heavy for a new account, or mostly failing.
    if (a_has('bc_llm_usage')) {
        foreach (a_rows("SELECT account_id a, COUNT(*) n, SUM(ok=0) e, SUM(created_at >= ?) d FROM bc_llm_usage WHERE created_at >= ? AND account_id IS NOT NULL GROUP BY account_id",
                        [a_ago_sql(86400), a_ago_sql(7 * 86400)]) as $r) {
            $a = (int)$r['a']; $acc = $accs[$a] ?? null;
            if ($acc && $now - strtotime((string)$acc['created_at']) < 48 * 3600 && (int)$r['d'] > 150) $add($a, 20, 'Heavy AI use for a new account (' . (int)$r['d'] . ' calls today)', 'ai');
            if ((int)$r['n'] >= 20 && (int)$r['e'] / (int)$r['n'] >= 0.4) $add($a, 10, round(100 * (int)$r['e'] / (int)$r['n']) . '% of AI calls fail', 'ai');
        }
    }
    $memo = [];
    foreach ($sig as $a => $list) {
        if (!isset($accs[$a])) continue;
        usort($list, fn($x, $y) => $y['pts'] <=> $x['pts']);
        $memo[$a] = ['score' => min(100, array_sum(array_column($list, 'pts'))), 'reasons' => $list];
    }
    return $memo;
}
function a_risk_level(int $s): string { return $s >= 60 ? 'high' : ($s >= 30 ? 'medium' : ($s > 0 ? 'low' : 'none')); }

// Friendly names for the code that made an AI call.
function a_purpose_label(string $p): string {
    $map = [
        'bc_act_ai_reply' => 'Agent replies', 'shop_reply_core' => 'Agent replies', 'dm_ai_compose' => 'Direct-chat replies',
        'dm_offline_run' => 'Direct-chat replies', 'bot_job_run' => 'Bot replies', 'persona_line' => 'Agent one-liners',
        'persona_stall_line' => 'Agent one-liners', 'bc_act_classify_order' => 'Order checks', 'bc_act_compose_agent_question' => 'Agent questions',
        'bc_act_onboarding' => 'Onboarding', 'action:ghost_command' => 'Ghost assistant', 'action:classify_key_mode' => 'Key-mode checks',
        'action:compose_payment_line' => 'Delivery messages', 'action:sched_compose' => 'Scheduled messages', 'bot_sched_run' => 'Scheduled messages',
    ];
    if (isset($map[$p])) return $map[$p];
    if (stripos($p, 'ghost') !== false) return 'Ghost assistant';
    return $p === '' || $p === 'action:' ? 'Other' : $p;
}

// ── Bots (bc_bot_relay) ──────────────────────────────────────
// Is a bot token saved for this account? The same places api.php looks:
// tg_bot_token / dc_bot_token, then the active bot in 'platform_accounts'.
function a_bot_token_saved(int $acc, string $platform): bool {
    static $memo = [];
    $k = $acc . ':' . $platform;
    if (isset($memo[$k])) return $memo[$k];
    $v = trim((string)a_val("SELECT value FROM bc_credentials WHERE account_id=? AND `key`=?", [$acc, $platform === 'discord' ? 'dc_bot_token' : 'tg_bot_token'], ''));
    if ($v !== '') return $memo[$k] = true;
    $m = json_decode((string)a_val("SELECT meta FROM bc_credentials WHERE account_id=? AND `key`='platform_accounts'", [$acc], ''), true);
    if (is_array($m)) {
        $active = (string)($m[$platform === 'discord' ? 'activeDc' : 'activeTg'] ?? '');
        foreach ((array)($m[$platform] ?? []) as $a) {
            if (!is_array($a) || $active === '' || (string)($a['id'] ?? '') !== $active) continue;
            if ($platform === 'telegram' && ($a['mode'] ?? 'bot') !== 'bot') break;
            if (trim((string)($a['token'] ?? '')) !== '') return $memo[$k] = true;
        }
    }
    return $memo[$k] = false;
}
// Bot rows with what is true now: 'state' is on | desktop (the desktop app
// is receiving for it) | erroring | off, 'token' whether one is saved, and
// 'error' only an error that still holds — not one from before the token
// was saved, before the desktop app took over, or after the bot recovered.
function a_bot_rows(?int $acc = null): array {
    if (!a_has('bc_bot_relay')) return [];
    $host = a_col('bc_bot_relay', 'host_at') ? "(host_at IS NOT NULL AND host_at > NOW() - INTERVAL 90 SECOND)" : '0';
    $rows = a_rows("SELECT account_id, platform, on_flag, bot_name, username, polled_at, fails, last_error, error_at, $host host_live,
                           TIMESTAMPDIFF(SECOND, polled_at, NOW()) since_poll
                      FROM bc_bot_relay" . ($acc !== null ? " WHERE account_id=?" : '') . " ORDER BY on_flag DESC, error_at DESC LIMIT 200", $acc !== null ? [$acc] : []);
    foreach ($rows as &$x) {
        $on = (int)$x['on_flag'] === 1;
        $tok = a_bot_token_saved((int)$x['account_id'], (string)$x['platform']);
        $err = (string)($x['last_error'] ?? '');
        if (!$on || !empty($x['host_live']) || (int)$x['fails'] === 0) $err = '';
        if ($err === 'No bot token saved.' && $tok) $err = '';       // saved since: the next poll picks it up
        if ($err === '' && $on && !$tok && empty($x['host_live'])) $err = 'No bot token saved.';
        $x['token'] = $tok;
        $x['error'] = $err;
        $x['state'] = !$on ? 'off' : (!empty($x['host_live']) ? 'desktop' : ($err !== '' ? 'erroring' : 'on'));
        unset($x['last_error'], $x['host_live']);
    }
    unset($x);
    return $rows;
}

// ══ READ ENDPOINTS ═══════════════════════════════════════════

function api_overview(): array {
    $today = a_today();
    $g = a_c('bc_accounts', 'is_guest', '0');
    $acc = a_row("SELECT SUM($g=0) accounts, SUM($g=1) guests,
                         SUM($g=0 AND created_at >= ?) su_today, SUM($g=0 AND created_at >= ?) su_7d, SUM($g=0 AND created_at >= ?) su_prev7,
                         SUM($g=1 AND created_at >= ?) g_today, SUM(" . a_c('bc_accounts', 'suspended_at') . " IS NOT NULL) suspended,
                         SUM(" . a_c('bc_accounts', 'claimed_at') . " IS NOT NULL) claimed
                    FROM bc_accounts", [$today, a_ago_sql(7 * 86400), a_ago_sql(14 * 86400), $today]);
    $acc['su_prev7'] = (int)($acc['su_prev7'] ?? 0) - (int)($acc['su_7d'] ?? 0);

    // Who's around: any request in the last 5 minutes, and daily / weekly actives.
    $seen = function (int $sec) {
        $t = a_ago_sql($sec);
        $parts = [];
        if (a_col('bc_accounts', 'last_seen_at')) $parts[] = "SELECT id FROM bc_accounts WHERE last_seen_at >= '$t'";
        $parts[] = "SELECT id FROM bc_accounts WHERE last_login >= '$t'";
        if (a_col('bc_dm_profile', 'last_seen')) $parts[] = "SELECT account_id FROM bc_dm_profile WHERE last_seen >= '$t'";
        return (int)a_val("SELECT COUNT(*) FROM (" . implode(' UNION ', $parts) . ") x");
    };
    $online = $seen(300); $dau = $seen(86400); $wau = $seen(7 * 86400); $mau = $seen(30 * 86400);

    // Messages today, and AI replies among them.
    $agent = a_col('bc_messages', 'agent_name') ? "SUM(role<>'in' AND agent_name<>'')" : '0';
    $m = a_has('bc_messages') ? a_row("SELECT COUNT(*) n, $agent ai FROM bc_messages WHERE created_at >= ? AND LEFT(conv_id,3) <> 'dm_'", [$today]) : [];
    $dmAi = a_col('bc_dm_messages', 'ai_agent') ? 'SUM(ai_agent<>0)' : '0';
    $d = a_has('bc_dm_messages') ? a_row("SELECT COUNT(*) n, $dmAi ai FROM bc_dm_messages WHERE id >= ?", [a_dm_id_since($today)]) : [];
    $msgToday = (int)($m['n'] ?? 0) + (int)($d['n'] ?? 0);
    $aiToday = (int)($m['ai'] ?? 0) + (int)($d['ai'] ?? 0);

    // AI spend
    $llm = function (string $from) {
        $o = ['calls' => 0, 'errors' => 0, 'cost' => 0.0, 'tokens' => 0];
        if (!a_has('bc_llm_usage')) return $o;
        foreach (a_rows("SELECT provider, model, COUNT(*) n, SUM(ok=0) e, SUM(input_tokens) i, SUM(cached_tokens) c, SUM(output_tokens) o
                           FROM bc_llm_usage WHERE created_at >= ? AND " . a_llm_where() . " GROUP BY provider, model", [$from]) as $r) {
            $o['calls'] += (int)$r['n']; $o['errors'] += (int)$r['e']; $o['tokens'] += (int)$r['i'] + (int)$r['o'];
            $o['cost'] += a_cost((string)$r['model'], (string)$r['provider'], (float)$r['i'], (float)$r['c'], (float)$r['o']);
        }
        return $o;
    };
    $llmToday = $llm($today); $llm30 = $llm(a_ago_sql(30 * 86400));

    // Sales
    $sum = function (array $rows) { $u = 0.0; $n = 0; foreach ($rows as $r) if ($r['paid']) { $n++; $u += (float)$r['usd']; } return ['usd' => $u, 'n' => $n]; };
    $s30 = a_sales_rows(a_ago_sql(30 * 86400));
    $sToday = array_filter($s30, fn($r) => (string)$r['created_at'] >= $today);
    $sales30 = $sum($s30); $salesToday = $sum($sToday);
    $take = (float)a_setting('take_rate', 0);

    // 30-day trends
    $r = a_range('30d');
    $bm = a_b('created_at', $r);
    $su = []; $gu = [];
    foreach (a_rows("SELECT $bm b, SUM($g=0) a, SUM($g=1) g FROM bc_accounts WHERE created_at >= ? GROUP BY b", [$r['from']]) as $x) { $su[$x['b']] = (int)$x['a']; $gu[$x['b']] = (int)$x['g']; }
    $ch = a_channels_series($r);
    $costDay = [];
    if (a_has('bc_llm_usage')) {
        foreach (a_rows("SELECT $bm b, provider, model, SUM(input_tokens) i, SUM(cached_tokens) c, SUM(output_tokens) o FROM bc_llm_usage WHERE created_at >= ? AND " . a_llm_where() . " GROUP BY b, provider, model", [$r['from']]) as $x) {
            $costDay[$x['b']] = ($costDay[$x['b']] ?? 0) + a_cost((string)$x['model'], (string)$x['provider'], (float)$x['i'], (float)$x['c'], (float)$x['o']);
        }
    }
    $salesDay = [];
    foreach ($s30 as $x) if ($x['paid']) { $b = substr((string)$x['created_at'], 0, 10); $salesDay[$b] = ($salesDay[$b] ?? 0) + (float)$x['usd']; }

    // Risk summary
    $risk = a_risk_all();
    $high = 0; $med = 0;
    foreach ($risk as $v) { if ($v['score'] >= 60) $high++; elseif ($v['score'] >= 30) $med++; }
    $cool = 0;
    if (a_col('bc_dm_ai', 'spam_until')) $cool += (int)a_val("SELECT COUNT(*) FROM bc_dm_ai WHERE spam_until > NOW()");
    if (a_has('bc_bot_conv')) $cool += (int)a_val("SELECT COUNT(*) FROM bc_bot_conv WHERE spam_until > NOW()");

    // Top accounts
    $all = a_accounts_all();
    $msg7 = a_msg_by_account(a_ago_sql(7 * 86400));
    $llmA = a_llm_by_account(a_ago_sql(30 * 86400));
    $salesA = a_sales_by_account(a_ago_sql(30 * 86400));
    $top = function (array $map, callable $val, int $n = 6) use ($all) {
        $o = [];
        foreach ($map as $a => $v) if (isset($all[$a])) $o[] = ['acc' => a_acc_brief($all[$a]), 'v' => $val($v)];
        usort($o, fn($x, $y) => $y['v'] <=> $x['v']);
        return array_values(array_filter(array_slice($o, 0, $n), fn($x) => $x['v'] > 0));
    };

    return [
        'kpi' => [
            'accounts' => (int)($acc['accounts'] ?? 0), 'guests' => (int)($acc['guests'] ?? 0), 'claimed' => (int)($acc['claimed'] ?? 0),
            'signups_today' => (int)($acc['su_today'] ?? 0), 'signups_7d' => (int)($acc['su_7d'] ?? 0), 'signups_prev7' => max(0, (int)$acc['su_prev7']),
            'guests_today' => (int)($acc['g_today'] ?? 0), 'suspended' => (int)($acc['suspended'] ?? 0),
            'online' => $online, 'dau' => $dau, 'wau' => $wau, 'mau' => $mau,
            'msg_today' => $msgToday, 'ai_today' => $aiToday,
            'llm_today' => $llmToday, 'llm_30d' => $llm30,
            'sales_today' => $salesToday, 'sales_30d' => $sales30, 'take_rate' => $take,
            'earn_30d' => $sales30['usd'] * $take / 100,
            'risk_high' => $high, 'risk_med' => $med, 'cooldowns' => $cool,
            'llm_paused' => (string)a_setting('llm_pause', '0') === '1',
            'ai_scope' => a_ai_scope(), 'builtin' => a_builtin() + ['users' => a_builtin_users()],
        ],
        'series' => [
            'labels' => $r['buckets'], 'signups' => a_fill($r, $su), 'guests' => a_fill($r, $gu),
            'telegram' => $ch['telegram'], 'discord' => $ch['discord'], 'direct' => $ch['direct'], 'ai' => $ch['ai'],
            'cost' => array_map(fn($v) => round($v, 4), a_fill($r, $costDay, 0.0)),
            'sales' => array_map(fn($v) => round($v, 2), a_fill($r, $salesDay, 0.0)),
        ],
        'pulse' => a_pulse(),
        'feed' => a_feed(28),
        'top' => [
            'messages' => $top($msg7, fn($v) => $v['n'] + $v['dm_sent'] + $v['dm_recv']),
            'cost' => $top($llmA, fn($v) => round($v['cost'], 4)),
            'sales' => $top($salesA, fn($v) => round($v['usd'], 2)),
        ],
    ];
}

// Messages per bucket on each channel, plus AI-written ones.
function a_channels_series(array $r): array {
    $tg = []; $dc = []; $dm = []; $ai = []; $in = []; $out = [];
    $bm = a_b('m.created_at', $r);
    if (a_has('bc_messages')) {
        $agent = a_col('bc_messages', 'agent_name') ? "SUM(m.role<>'in' AND m.agent_name<>'')" : '0';
        foreach (a_rows("SELECT $bm b, COALESCE(c.platform,'telegram') p, COUNT(*) n, SUM(m.role='in') i, $agent ai
                           FROM bc_messages m LEFT JOIN bc_conversations c ON c.account_id = m.account_id AND c.id = m.conv_id
                          WHERE m.created_at >= ? AND LEFT(m.conv_id,3) <> 'dm_' GROUP BY b, p", [$r['from']]) as $x) {
            $b = $x['b'];
            if ($x['p'] === 'discord') $dc[$b] = ($dc[$b] ?? 0) + (int)$x['n'];
            elseif ($x['p'] === 'direct') $dm[$b] = ($dm[$b] ?? 0) + (int)$x['n'];
            else $tg[$b] = ($tg[$b] ?? 0) + (int)$x['n'];
            $ai[$b] = ($ai[$b] ?? 0) + (int)$x['ai'];
            $in[$b] = ($in[$b] ?? 0) + (int)$x['i'];
            $out[$b] = ($out[$b] ?? 0) + (int)$x['n'] - (int)$x['i'];
        }
    }
    if (a_has('bc_dm_messages')) {
        $bd = a_b('created_at', $r);
        $dmAi = a_col('bc_dm_messages', 'ai_agent') ? 'SUM(ai_agent<>0)' : '0';
        foreach (a_rows("SELECT $bd b, COUNT(*) n, $dmAi ai FROM bc_dm_messages WHERE id >= ? GROUP BY b", [a_dm_id_since($r['from'])]) as $x) {
            $dm[$x['b']] = ($dm[$x['b']] ?? 0) + (int)$x['n'];
            $ai[$x['b']] = ($ai[$x['b']] ?? 0) + (int)$x['ai'];
        }
    }
    return ['telegram' => a_fill($r, $tg), 'discord' => a_fill($r, $dc), 'direct' => a_fill($r, $dm), 'ai' => a_fill($r, $ai),
            'inbound' => a_fill($r, $in), 'outbound' => a_fill($r, $out)];
}

// The last hour, minute by minute: messages and AI calls.
function a_pulse(): array {
    $now = strtotime(a_now());
    $start = strtotime(date('Y-m-d H:i:00', $now)) - 59 * 60;
    $labels = []; for ($i = 0; $i < 60; $i++) $labels[] = date('H:i', $start + $i * 60);
    $from = date('Y-m-d H:i:s', $start);
    $msg = []; $llm = []; $err = [];
    if (a_has('bc_messages')) foreach (a_rows("SELECT DATE_FORMAT(created_at,'%H:%i') b, COUNT(*) n FROM bc_messages WHERE created_at >= ? AND LEFT(conv_id,3) <> 'dm_' GROUP BY b", [$from]) as $x) $msg[$x['b']] = (int)$x['n'];
    if (a_has('bc_dm_messages')) foreach (a_rows("SELECT DATE_FORMAT(created_at,'%H:%i') b, COUNT(*) n FROM bc_dm_messages WHERE id >= ? GROUP BY b", [a_dm_id_since($from)]) as $x) $msg[$x['b']] = ($msg[$x['b']] ?? 0) + (int)$x['n'];
    if (a_has('bc_llm_usage')) foreach (a_rows("SELECT DATE_FORMAT(created_at,'%H:%i') b, COUNT(*) n, SUM(ok=0) e FROM bc_llm_usage WHERE created_at >= ? GROUP BY b", [$from]) as $x) { $llm[$x['b']] = (int)$x['n']; $err[$x['b']] = (int)$x['e']; }
    $f = fn($m) => array_map(fn($l) => $m[$l] ?? 0, $labels);
    return ['labels' => $labels, 'messages' => $f($msg), 'llm' => $f($llm), 'errors' => $f($err)];
}

// What just happened, newest first.
function a_feed(int $n): array {
    $ev = [];
    $g = a_c('bc_accounts', 'is_guest', '0');
    foreach (a_rows("SELECT id, username, display_name, created_at, $g is_guest, " . a_c('bc_accounts', 'guest_of') . " guest_of FROM bc_accounts ORDER BY id DESC LIMIT 12") as $r) {
        $ev[] = ['t' => $r['created_at'], 'kind' => $r['is_guest'] ? 'guest' : 'signup', 'acc' => (int)$r['id'],
                 'text' => $r['is_guest'] ? (($r['display_name'] ?: $r['username']) . ' started a guest chat with ' . a_name_of((int)$r['guest_of']))
                                           : (($r['display_name'] ?: $r['username']) . ' created an account')];
    }
    foreach (a_sales_rows(null, null, 10) as $r) {
        $amt = trim((string)$r['amount']) . ' ' . (string)$r['currency'];
        $ev[] = ['t' => $r['created_at'], 'kind' => $r['paid'] ? 'sale' : 'tx', 'acc' => (int)$r['account_id'],
                 'text' => a_name_of((int)$r['account_id']) . ($r['paid'] ? ($r['product'] ? ' sold ' . $r['product'] : ' made a sale') : ' recorded an unpaid order') . ' · ' . trim($amt)];
    }
    if (a_has('bc_llm_usage')) foreach (a_rows("SELECT account_id, provider, model, error, created_at FROM bc_llm_usage WHERE ok=0 ORDER BY id DESC LIMIT 8") as $r) {
        $ev[] = ['t' => $r['created_at'], 'kind' => 'error', 'acc' => (int)$r['account_id'],
                 'text' => 'AI call failed for ' . a_name_of((int)$r['account_id']) . ' (' . $r['model'] . '): ' . mb_substr((string)$r['error'], 0, 90)];
    }
    if (a_col('bc_dm_ai', 'spam_until')) foreach (a_rows("SELECT account_id, thread_id, spam_hits, spam_reason, updated_at FROM bc_dm_ai WHERE spam_until > NOW() - INTERVAL 1 DAY ORDER BY updated_at DESC LIMIT 6") as $r) {
        $ev[] = ['t' => $r['updated_at'], 'kind' => 'spam', 'acc' => (int)$r['account_id'],
                 'text' => 'Spam cooldown in a direct chat of ' . a_name_of((int)$r['account_id']) . ($r['spam_reason'] ? ': ' . mb_substr((string)$r['spam_reason'], 0, 80) : '')];
    }
    $nb = 0;
    foreach (a_bot_rows() as $r) {
        // Only errors that still hold (see a_bot_rows).
        if ($r['error'] === '' || empty($r['error_at']) || strtotime((string)$r['error_at']) < strtotime(a_now()) - 86400 || ++$nb > 6) continue;
        $ev[] = ['t' => $r['error_at'], 'kind' => 'bot', 'acc' => (int)$r['account_id'],
                 'text' => ucfirst((string)$r['platform']) . ' bot of ' . a_name_of((int)$r['account_id']) . ': ' . mb_substr($r['error'], 0, 90)];
    }
    foreach (a_rows("SELECT action, target_id, detail, created_at FROM bc_admin_audit WHERE action NOT IN ('login','logout') ORDER BY id DESC LIMIT 6") as $r) {
        $ev[] = ['t' => $r['created_at'], 'kind' => 'admin', 'acc' => (int)$r['target_id'], 'text' => 'You: ' . $r['detail']];
    }
    usort($ev, fn($a, $b) => strcmp((string)$b['t'], (string)$a['t']));
    return array_slice($ev, 0, $n);
}

function api_accounts(array $q): array {
    $type = (string)($q['type'] ?? 'accounts');
    $sort = (string)($q['sort'] ?? 'created');
    $dir = ($q['dir'] ?? 'desc') === 'asc' ? 1 : -1;
    $page = max(1, (int)($q['page'] ?? 1));
    $per = 25;
    $needle = mb_strtolower(trim((string)($q['q'] ?? '')));
    $all = a_accounts_all();
    $risk = a_risk_all();
    $from30 = a_ago_sql(30 * 86400);
    $msg = a_msg_by_account($from30);
    $llm = a_llm_by_account($from30);
    $sales = a_sales_by_account(null);
    $conv = []; foreach (a_rows("SELECT account_id a, COUNT(*) n FROM bc_conversations GROUP BY account_id") as $r) $conv[(int)$r['a']] = (int)$r['n'];
    $bots = []; if (a_has('bc_bot_relay')) foreach (a_rows("SELECT account_id a, SUM(on_flag=1) n FROM bc_bot_relay GROUP BY account_id") as $r) $bots[(int)$r['a']] = (int)$r['n'];
    $gRecv = []; if (a_col('bc_accounts', 'guest_of')) foreach (a_rows("SELECT guest_of a, COUNT(*) n FROM bc_accounts WHERE guest_of IS NOT NULL GROUP BY guest_of") as $r) $gRecv[(int)$r['a']] = (int)$r['n'];
    $now = strtotime(a_now());
    $counts = ['all' => 0, 'accounts' => 0, 'guests' => 0, 'suspended' => 0, 'new' => 0, 'flagged' => 0, 'online' => 0];
    $rows = [];
    foreach ($all as $id => $a) {
        $isG = !empty($a['is_guest']);
        $isNew = $now - strtotime((string)$a['created_at']) < 7 * 86400;
        $isOn = $a['seen'] && $now - strtotime((string)$a['seen']) < 300;
        $sc = $risk[$id]['score'] ?? 0;
        $counts['all']++;
        $counts[$isG ? 'guests' : 'accounts']++;
        if (!empty($a['suspended_at'])) $counts['suspended']++;
        if ($isNew && !$isG) $counts['new']++;
        if ($sc >= 30) $counts['flagged']++;
        if ($isOn) $counts['online']++;
        $which = ['guests' => $isG, 'suspended' => !empty($a['suspended_at']), 'new' => $isNew && !$isG,
                  'flagged' => $sc >= 30, 'online' => $isOn, 'all' => true];
        $ok = array_key_exists($type, $which) ? $which[$type] : !$isG;
        if (!$ok) continue;
        if ($needle !== '') {
            $hay = mb_strtolower($id . ' ' . $a['username'] . ' ' . $a['display_name'] . ' ' . ($isG ? '' : $a['email']));
            if (mb_strpos($hay, ltrim($needle, '#@')) === false) continue;
        }
        $m = $msg[$id] ?? ['n' => 0, 'ai' => 0, 'dm_sent' => 0, 'dm_recv' => 0, 'dm_ai' => 0];
        $rows[] = a_acc_brief($a) + [
            'guest_of' => $isG ? ['id' => (int)$a['guest_of'], 'name' => a_name_of((int)$a['guest_of'])] : null,
            'claimed' => !empty($a['claimed_at']),
            'msgs' => $m['n'] + $m['dm_sent'] + $m['dm_recv'], 'ai' => $m['ai'] + $m['dm_ai'],
            'cost' => round($llm[$id]['cost'] ?? 0, 4), 'calls' => $llm[$id]['calls'] ?? 0,
            'sales' => round($sales[$id]['usd'] ?? 0, 2), 'orders' => $sales[$id]['n'] ?? 0,
            'convs' => $conv[$id] ?? 0, 'bots' => $bots[$id] ?? 0, 'guests_in' => $gRecv[$id] ?? 0,
            'risk' => $sc, 'risk_top' => $risk[$id]['reasons'][0]['why'] ?? '', 'online' => $isOn,
        ];
    }
    $key = ['created' => 'created', 'seen' => 'seen', 'msgs' => 'msgs', 'ai' => 'ai', 'cost' => 'cost', 'sales' => 'sales', 'risk' => 'risk', 'name' => 'name', 'convs' => 'convs', 'id' => 'id'][$sort] ?? 'created';
    usort($rows, function ($x, $y) use ($key, $dir) {
        $a = $x[$key]; $b = $y[$key];
        $c = is_string($a) || is_string($b) ? strcasecmp((string)$a, (string)$b) : ($a <=> $b);
        return $c === 0 ? ($y['id'] <=> $x['id']) : $c * $dir;
    });
    $total = count($rows);
    return ['rows' => array_slice($rows, ($page - 1) * $per, $per), 'total' => $total, 'page' => $page, 'pages' => max(1, (int)ceil($total / $per)), 'counts' => $counts, 'ai_scope' => a_ai_scope()];
}

function api_account(int $id): array {
    $all = a_accounts_all();
    $a = $all[$id] ?? null;
    if (!$a) a_fail('That account no longer exists.', 404);
    $risk = a_risk_all()[$id] ?? ['score' => 0, 'reasons' => []];
    $isG = !empty($a['is_guest']);
    $r = a_range('30d');
    $from30 = $r['from'];
    $ipN = 0;
    if (!empty($a['guest_ip'])) $ipN = (int)a_val("SELECT COUNT(*) FROM bc_accounts WHERE guest_ip=?", [$a['guest_ip']]);

    // Messages per day on each channel for this account.
    $tg = []; $dc = []; $dmS = []; $ai = [];
    $bm = a_b('m.created_at', $r);
    if (a_has('bc_messages')) {
        $agent = a_col('bc_messages', 'agent_name') ? "SUM(m.role<>'in' AND m.agent_name<>'')" : '0';
        foreach (a_rows("SELECT $bm b, COALESCE(c.platform,'telegram') p, COUNT(*) n, $agent ai FROM bc_messages m
                           LEFT JOIN bc_conversations c ON c.account_id = m.account_id AND c.id = m.conv_id
                          WHERE m.account_id = ? AND m.created_at >= ? AND LEFT(m.conv_id,3) <> 'dm_' GROUP BY b, p", [$id, $from30]) as $x) {
            if ($x['p'] === 'discord') $dc[$x['b']] = ($dc[$x['b']] ?? 0) + (int)$x['n']; else $tg[$x['b']] = ($tg[$x['b']] ?? 0) + (int)$x['n'];
            $ai[$x['b']] = ($ai[$x['b']] ?? 0) + (int)$x['ai'];
        }
    }
    if (a_has('bc_dm_messages')) {
        $dmAi = a_col('bc_dm_messages', 'ai_agent') ? 'SUM(ai_agent<>0)' : '0';
        foreach (a_rows("SELECT DATE(created_at) b, COUNT(*) n, $dmAi ai FROM bc_dm_messages WHERE id >= ? AND (sender_id = ? OR recipient_id = ?) GROUP BY b",
                        [a_dm_id_since($from30), $id, $id]) as $x) {
            $dmS[$x['b']] = (int)$x['n']; $ai[$x['b']] = ($ai[$x['b']] ?? 0) + (int)$x['ai'];
        }
    }
    $allMsg = a_has('bc_messages') ? (int)a_val("SELECT COUNT(*) FROM bc_messages WHERE account_id=? AND LEFT(conv_id,3) <> 'dm_'", [$id]) : 0;
    $allDm = a_has('bc_dm_messages') ? (int)a_val("SELECT (SELECT COUNT(*) FROM bc_dm_messages WHERE sender_id=?) + (SELECT COUNT(*) FROM bc_dm_messages WHERE recipient_id=?)", [$id, $id]) : 0;

    // AI usage
    $llm = ['calls' => 0, 'errors' => 0, 'in' => 0, 'out' => 0, 'cost' => 0.0, 'cost_all' => 0.0, 'models' => [], 'daily' => [], 'errors_recent' => [], 'scope' => a_ai_scope()];
    if (a_has('bc_llm_usage')) {
        $day = [];
        foreach (a_rows("SELECT DATE(created_at) b, provider, model, COUNT(*) n, SUM(ok=0) e, SUM(input_tokens) i, SUM(cached_tokens) c, SUM(output_tokens) o, SUM(latency_ms) l
                           FROM bc_llm_usage WHERE account_id=? AND created_at >= ? AND " . a_llm_where() . " GROUP BY b, provider, model", [$id, $from30]) as $x) {
            $c = a_cost((string)$x['model'], (string)$x['provider'], (float)$x['i'], (float)$x['c'], (float)$x['o']);
            $llm['calls'] += (int)$x['n']; $llm['errors'] += (int)$x['e']; $llm['in'] += (int)$x['i']; $llm['out'] += (int)$x['o']; $llm['cost'] += $c;
            $day[$x['b']] = ($day[$x['b']] ?? 0) + $c;
            $mk = (string)$x['model'];
            $llm['models'][$mk] = $llm['models'][$mk] ?? ['model' => $mk, 'provider' => $x['provider'], 'calls' => 0, 'cost' => 0.0, 'tokens' => 0, 'lat' => 0];
            $llm['models'][$mk]['calls'] += (int)$x['n']; $llm['models'][$mk]['cost'] += $c; $llm['models'][$mk]['tokens'] += (int)$x['i'] + (int)$x['o']; $llm['models'][$mk]['lat'] += (int)$x['l'];
        }
        foreach (a_rows("SELECT provider, model, SUM(input_tokens) i, SUM(cached_tokens) c, SUM(output_tokens) o FROM bc_llm_usage WHERE account_id=? AND " . a_llm_where() . " GROUP BY provider, model", [$id]) as $x) {
            $llm['cost_all'] += a_cost((string)$x['model'], (string)$x['provider'], (float)$x['i'], (float)$x['c'], (float)$x['o']);
        }
        $llm['daily'] = array_map(fn($v) => round($v, 4), a_fill($r, $day, 0.0));
        $llm['models'] = array_values($llm['models']);
        usort($llm['models'], fn($x, $y) => $y['cost'] <=> $x['cost']);
        $llm['errors_recent'] = a_rows("SELECT model, error, created_at FROM bc_llm_usage WHERE account_id=? AND ok=0 AND " . a_llm_where() . " ORDER BY id DESC LIMIT 8", [$id]);
    }

    // Setup: AI provider and keys (masked), bots, contact page.
    $cred = [];
    foreach (a_rows("SELECT `key`, value FROM bc_credentials WHERE account_id=? AND `key` IN ('llm_active','llm_gemini','llm_openai','llm_claude','llm_gemini_model','llm_openai_model','llm_claude_model','tg_bot_token','dc_bot_token')", [$id]) as $x) {
        $v = (string)$x['value'];
        $cred[$x['key']] = (preg_match('/model$|active$/', $x['key']) ? $v : ($v === '' ? '' : '••••' . substr($v, -4)));
    }
    $bots = a_bot_rows($id);
    // A token saved but the bot never switched on here: still worth showing.
    foreach (['telegram', 'discord'] as $pl) {
        if (!array_filter($bots, fn($b) => $b['platform'] === $pl) && a_bot_token_saved($id, $pl)) {
            $bots[] = ['account_id' => $id, 'platform' => $pl, 'on_flag' => 0, 'bot_name' => '', 'username' => '', 'polled_at' => null, 'fails' => 0,
                       'error_at' => null, 'since_poll' => null, 'token' => true, 'error' => '', 'state' => 'off'];
        }
    }
    $prof = a_has('bc_dm_profile') ? a_row("SELECT * FROM bc_dm_profile WHERE account_id=?", [$id]) : [];
    unset($prof['vault'], $prof['agent_priv'], $prof['page_theme']);

    $agents = a_rows("SELECT id, name, model, active, replies, conv, " . a_c('bc_agents', 'sell_catalog', '1') . " sell_catalog, updated_at FROM bc_agents WHERE account_id=? ORDER BY active DESC, replies DESC LIMIT 50", [$id]);
    $products = a_rows("SELECT id, name, type, price, " . a_c('bc_products', 'price_currency', "'USD'") . " currency, billing, stock, " . a_c('bc_products', 'enabled_for_ai', '1') . " enabled FROM bc_products WHERE account_id=? ORDER BY id DESC LIMIT 60", [$id]);
    $convs = a_rows("SELECT id, name, handle, platform, stage, ai_status, auto_reply, unread, LEFT(last_msg, 140) last_msg, updated_at FROM bc_conversations WHERE account_id=? ORDER BY updated_at DESC LIMIT 60", [$id]);
    $convN = (int)a_val("SELECT COUNT(*) FROM bc_conversations WHERE account_id=?", [$id]);
    $custN = a_has('bc_end_users') ? (int)a_val("SELECT COUNT(*) FROM bc_end_users WHERE account_id=?", [$id]) : 0;
    $blockedN = a_has('bc_end_users') ? (int)a_val("SELECT COUNT(*) FROM bc_end_users WHERE account_id=? AND is_blocked=1", [$id]) : 0;
    $licN = a_has('bc_end_user_products') ? (int)a_val("SELECT COUNT(*) FROM bc_end_user_products WHERE account_id=?", [$id]) : 0;
    $sales = a_sales_rows(null, $id);
    $paid = array_filter($sales, fn($x) => $x['paid']);
    $sales30 = array_filter($paid, fn($x) => (string)$x['created_at'] >= $from30);
    $sDay = [];
    foreach ($sales30 as $x) { $b = substr((string)$x['created_at'], 0, 10); $sDay[$b] = ($sDay[$b] ?? 0) + (float)$x['usd']; }
    $inv = a_invoices(null, $id);
    $invS = ['pending' => 0, 'confirmed' => 0, 'cancelled' => 0, 'expired' => 0, 'other' => 0];
    foreach ($inv as $x) $invS[isset($invS[$x['status']]) ? $x['status'] : 'other']++;
    usort($inv, fn($x, $y) => $y['created'] <=> $x['created']);

    // Direct chats (content is end-to-end encrypted: counts and people only).
    $threads = [];
    if (a_has('bc_dm_threads')) {
        foreach (a_rows("SELECT t.id, IF(t.a_id=?, t.b_id, t.a_id) peer, t.created_at, t.updated_at, IF(t.a_id=?, t.a_blocked, t.b_blocked) i_blocked, IF(t.a_id=?, t.b_blocked, t.a_blocked) they_blocked,
                                (SELECT COUNT(*) FROM bc_dm_messages m WHERE m.thread_id=t.id) n
                           FROM bc_dm_threads t WHERE t.a_id=? OR t.b_id=? ORDER BY t.updated_at DESC LIMIT 40", [$id, $id, $id, $id, $id]) as $t) {
            $p = $all[(int)$t['peer']] ?? null;
            $threads[] = ['id' => (int)$t['id'], 'peer' => a_acc_brief($p) ?: ['id' => (int)$t['peer'], 'name' => '#' . $t['peer'], 'guest' => false],
                          'n' => (int)$t['n'], 'updated' => $t['updated_at'], 'i_blocked' => (int)$t['i_blocked'], 'they_blocked' => (int)$t['they_blocked']];
        }
    }
    $guests = [];
    if (!$isG && a_col('bc_accounts', 'guest_of')) {
        foreach (a_rows("SELECT id FROM bc_accounts WHERE guest_of=? ORDER BY id DESC LIMIT 30", [$id]) as $x) $guests[] = a_acc_brief($all[(int)$x['id']] ?? null);
        $guests = array_values(array_filter($guests));
    }
    $cool = [];
    if (a_col('bc_dm_ai', 'spam_until')) foreach (a_rows("SELECT thread_id, spam_hits, spam_reason, spam_until FROM bc_dm_ai WHERE account_id=? AND spam_hits > 0 ORDER BY spam_until DESC LIMIT 20", [$id]) as $x) $cool[] = ['where' => 'Direct chat #' . $x['thread_id'], 'hits' => (int)$x['spam_hits'], 'reason' => $x['spam_reason'], 'until' => $x['spam_until']];
    if (a_has('bc_bot_conv')) foreach (a_rows("SELECT conv_id, spam_hits, spam_reason, spam_until FROM bc_bot_conv WHERE account_id=? AND spam_hits > 0 ORDER BY spam_until DESC LIMIT 20", [$id]) as $x) $cool[] = ['where' => $x['conv_id'], 'hits' => (int)$x['spam_hits'], 'reason' => $x['spam_reason'], 'until' => $x['spam_until']];
    $limits = a_has('bc_rate') ? a_rows("SELECT k, n, FROM_UNIXTIME(win_start) since FROM bc_rate WHERE k LIKE ? OR k LIKE ? OR k LIKE ? ORDER BY win_start DESC LIMIT 12", ["gm:$id:%", "ga:$id:%", "gao:$id:%"]) : [];

    $note = (string)a_val("SELECT note FROM bc_admin_notes WHERE account_id=?", [$id], '');
    $audit = a_rows("SELECT action, detail, created_at FROM bc_admin_audit WHERE target_id=? ORDER BY id DESC LIMIT 20", [$id]);
    $host = $isG ? a_acc_brief($all[(int)$a['guest_of']] ?? null) : null;

    return [
        'acc' => a_acc_brief($a) + [
            'last_login' => $a['last_login'], 'last_seen' => $a['last_seen_at'], 'claimed_at' => $a['claimed_at'],
            'suspended_at' => $a['suspended_at'], 'suspend_reason' => $a['suspend_reason'], 'ip_cluster' => $ipN, 'host' => $host,
        ],
        'risk' => $risk,
        'stats' => [
            'msgs_all' => $allMsg + $allDm, 'convs' => $convN, 'customers' => $custN, 'blocked_customers' => $blockedN, 'licenses' => $licN,
            'agents' => count($agents), 'products' => count($products),
            'sales_all' => array_sum(array_map(fn($x) => (float)$x['usd'], $paid)), 'orders_all' => count($paid),
            'sales_30d' => array_sum(array_map(fn($x) => (float)$x['usd'], $sales30)), 'orders_30d' => count($sales30),
            'other_currency' => count(array_filter($paid, fn($x) => $x['usd'] === null)),
        ],
        'series' => ['labels' => $r['buckets'], 'telegram' => a_fill($r, $tg), 'discord' => a_fill($r, $dc), 'direct' => a_fill($r, $dmS), 'ai' => a_fill($r, $ai),
                     'sales' => array_map(fn($v) => round($v, 2), a_fill($r, $sDay, 0.0))],
        'llm' => $llm, 'cred' => $cred, 'bots' => $bots, 'profile' => $prof,
        'agents' => $agents, 'products' => $products, 'convs' => $convs,
        'sales' => array_slice(array_values($sales), 0, 40), 'invoices' => array_slice($inv, 0, 30), 'invoice_counts' => $invS,
        'threads' => $threads, 'guests' => $guests, 'cooldowns' => $cool, 'limits' => $limits,
        'note' => $note, 'audit' => $audit,
    ];
}

function api_conversation(int $acc, string $conv): array {
    $c = a_row("SELECT id, name, handle, platform, chat_type, stage, ai_status, agent, auto_reply, " . a_c('bc_conversations', 'mem_summary', "''") . " mem_summary, updated_at
                  FROM bc_conversations WHERE account_id=? AND id=?", [$acc, $conv]);
    if (!$c) a_fail('Conversation not found.', 404);
    $cols = "id, role, LEFT(content, 4000) content, media_type, created_at";
    foreach (['agent_name' => "''", 'send_failed' => '0', 'deleted_at' => 'NULL', 'edited_at' => 'NULL', 'media_name' => "''"] as $col => $fb) $cols .= ', ' . a_c('bc_messages', $col, $fb) . " $col";
    $msgs = array_reverse(a_rows("SELECT $cols FROM bc_messages WHERE account_id=? AND conv_id=? ORDER BY id DESC LIMIT 300", [$acc, $conv]));
    $cust = a_has('bc_end_users') ? a_row("SELECT id, name, handle, email, verified, is_blocked, is_muted, created_at FROM bc_end_users WHERE account_id=? AND conv_id=?", [$acc, $conv]) : [];
    return ['conv' => $c, 'messages' => $msgs, 'customer' => $cust, 'owner' => a_acc_brief(a_accounts_all()[$acc] ?? null)];
}

function api_guests(array $q): array {
    $all = a_accounts_all();
    $filter = (string)($q['filter'] ?? 'all');
    $needle = mb_strtolower(trim((string)($q['q'] ?? '')));
    $guests = array_filter($all, fn($a) => !empty($a['is_guest']));
    $ids = array_keys($guests);
    $sent = []; $recv = []; $aiIn = [];
    if ($ids && a_has('bc_dm_messages')) {
        foreach (array_chunk($ids, 2000) as $chunk) {
            $in = implode(',', array_map('intval', $chunk));
            foreach (a_rows("SELECT sender_id a, COUNT(*) n FROM bc_dm_messages WHERE sender_id IN ($in) GROUP BY sender_id") as $r) $sent[(int)$r['a']] = (int)$r['n'];
            $ai = a_col('bc_dm_messages', 'ai_agent') ? 'SUM(ai_agent<>0)' : '0';
            foreach (a_rows("SELECT recipient_id a, COUNT(*) n, $ai ai FROM bc_dm_messages WHERE recipient_id IN ($in) GROUP BY recipient_id") as $r) { $recv[(int)$r['a']] = (int)$r['n']; $aiIn[(int)$r['a']] = (int)$r['ai']; }
        }
    }
    $ipc = [];
    foreach ($all as $a) if (!empty($a['guest_ip'])) $ipc[$a['guest_ip']] = ($ipc[$a['guest_ip']] ?? 0) + 1;
    $risk = a_risk_all();
    $now = strtotime(a_now());
    $stats = ['total' => count($guests), 'today' => 0, 'week' => 0, 'claimed' => 0, 'silent' => 0, 'active24' => 0, 'ai_replies' => array_sum($aiIn), 'messages' => array_sum($sent)];
    $hosts = [];
    $rows = [];
    foreach ($guests as $id => $a) {
        $age = $now - strtotime((string)$a['created_at']);
        $s = $sent[$id] ?? 0; $rc = $recv[$id] ?? 0;
        $claimed = !empty($a['claimed_at']);
        if ($age < 86400) $stats['today']++;
        if ($age < 7 * 86400) $stats['week']++;
        if ($claimed) $stats['claimed']++;
        if ($s + $rc === 0) $stats['silent']++;
        $on = $a['seen'] && $now - strtotime((string)$a['seen']) < 86400;
        if ($on) $stats['active24']++;
        $h = (int)$a['guest_of'];
        $hosts[$h] = ($hosts[$h] ?? 0) + 1;
        $which = ['silent' => $s + $rc === 0, 'active' => $on, 'claimed' => $claimed, 'flagged' => ($risk[$id]['score'] ?? 0) >= 30];
        $ok = array_key_exists($filter, $which) ? $which[$filter] : true;
        if (!$ok) continue;
        if ($needle !== '' && mb_strpos(mb_strtolower($id . ' ' . $a['username'] . ' ' . $a['display_name'] . ' ' . a_name_of($h)), ltrim($needle, '#@')) === false) continue;
        $rows[] = a_acc_brief($a) + ['host' => ['id' => $h, 'name' => a_name_of($h)], 'claimed' => $claimed, 'sent' => $s, 'recv' => $rc, 'ai' => $aiIn[$id] ?? 0,
                                     'cluster' => !empty($a['guest_ip']) ? ($ipc[$a['guest_ip']] ?? 1) : 1, 'risk' => $risk[$id]['score'] ?? 0,
                                     'risk_top' => $risk[$id]['reasons'][0]['why'] ?? ''];
    }
    usort($rows, fn($x, $y) => $y['id'] <=> $x['id']);
    arsort($hosts);
    $topHosts = [];
    foreach (array_slice($hosts, 0, 8, true) as $h => $n) $topHosts[] = ['id' => $h, 'name' => a_name_of($h), 'n' => $n];
    $r = a_range('30d');
    $gd = [];
    $gcol = a_c('bc_accounts', 'is_guest', '0');
    foreach (a_rows("SELECT DATE(created_at) b, COUNT(*) n FROM bc_accounts WHERE $gcol=1 AND created_at >= ? GROUP BY b", [$r['from']]) as $x) $gd[$x['b']] = (int)$x['n'];
    $cd = [];
    if (a_col('bc_accounts', 'claimed_at')) foreach (a_rows("SELECT DATE(claimed_at) b, COUNT(*) n FROM bc_accounts WHERE claimed_at >= ? GROUP BY b", [$r['from']]) as $x) $cd[$x['b']] = (int)$x['n'];
    return ['stats' => $stats, 'rows' => array_slice($rows, 0, 400), 'shown' => count($rows), 'hosts' => $topHosts,
            'series' => ['labels' => $r['buckets'], 'created' => a_fill($r, $gd), 'claimed' => a_fill($r, $cd)],
            'limits' => ['msg_min' => 10, 'msg_hour' => 120, 'msg_day' => 400, 'ai_hour' => 15, 'ai_day' => 60]];
}

function api_risk(): array {
    $all = a_accounts_all();
    $risk = a_risk_all();
    $rows = [];
    foreach ($risk as $id => $v) if (isset($all[$id])) $rows[] = ['acc' => a_acc_brief($all[$id]), 'score' => $v['score'], 'level' => a_risk_level($v['score']), 'reasons' => $v['reasons']];
    usort($rows, fn($x, $y) => $y['score'] <=> $x['score'] ?: $y['acc']['id'] <=> $x['acc']['id']);
    // Sign-up address clusters.
    $cl = [];
    if (a_col('bc_accounts', 'guest_ip')) {
        $g = a_c('bc_accounts', 'is_guest', '0');
        foreach (a_rows("SELECT guest_ip, COUNT(*) n, SUM($g=1) guests, MIN(created_at) first_at, MAX(created_at) last_at,
                                SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY id DESC), ',', 12) ids
                           FROM bc_accounts WHERE guest_ip IS NOT NULL AND guest_ip <> '' GROUP BY guest_ip HAVING n >= 3 ORDER BY n DESC LIMIT 40") as $x) {
            $members = [];
            foreach (explode(',', (string)$x['ids']) as $mid) if (isset($all[(int)$mid])) $members[] = a_acc_brief($all[(int)$mid]);
            $cl[] = ['tag' => substr((string)$x['guest_ip'], 0, 10), 'n' => (int)$x['n'], 'guests' => (int)$x['guests'], 'first' => $x['first_at'], 'last' => $x['last_at'], 'members' => $members];
        }
    }
    // Spam cooldowns running now.
    $cool = [];
    if (a_col('bc_dm_ai', 'spam_until')) {
        foreach (a_rows("SELECT d.account_id, d.thread_id, d.spam_hits, d.spam_reason, TIMESTAMPDIFF(SECOND, NOW(), d.spam_until) left_s,
                                IF(t.a_id = d.account_id, t.b_id, t.a_id) peer
                           FROM bc_dm_ai d LEFT JOIN bc_dm_threads t ON t.id = d.thread_id WHERE d.spam_until > NOW() ORDER BY d.spam_until DESC LIMIT 60") as $x) {
            $cool[] = ['owner' => a_acc_brief($all[(int)$x['account_id']] ?? null), 'who' => a_acc_brief($all[(int)$x['peer']] ?? null), 'where' => 'Direct chat',
                       'hits' => (int)$x['spam_hits'], 'reason' => $x['spam_reason'], 'left' => (int)$x['left_s']];
        }
    }
    if (a_has('bc_bot_conv')) {
        foreach (a_rows("SELECT b.account_id, b.conv_id, b.spam_hits, b.spam_reason, TIMESTAMPDIFF(SECOND, NOW(), b.spam_until) left_s, c.name
                           FROM bc_bot_conv b LEFT JOIN bc_conversations c ON c.account_id = b.account_id AND c.id = b.conv_id
                          WHERE b.spam_until > NOW() ORDER BY b.spam_until DESC LIMIT 60") as $x) {
            $cool[] = ['owner' => a_acc_brief($all[(int)$x['account_id']] ?? null), 'who' => ['name' => $x['name'] ?: $x['conv_id'], 'id' => 0], 'where' => ucfirst(explode('_', (string)$x['conv_id'])[0]),
                       'hits' => (int)$x['spam_hits'], 'reason' => $x['spam_reason'], 'left' => (int)$x['left_s']];
        }
    }
    // Spam hits over the last week, by reason.
    $reasons = [];
    if (a_col('bc_dm_ai', 'spam_reason')) foreach (a_rows("SELECT spam_reason r, SUM(spam_hits) n FROM bc_dm_ai WHERE spam_hits > 0 GROUP BY spam_reason ORDER BY n DESC LIMIT 10") as $x) $reasons[(string)$x['r'] ?: 'Unspecified'] = (int)$x['n'];
    if (a_has('bc_bot_conv')) foreach (a_rows("SELECT spam_reason r, SUM(spam_hits) n FROM bc_bot_conv WHERE spam_hits > 0 GROUP BY spam_reason ORDER BY n DESC LIMIT 10") as $x) { $k = (string)$x['r'] ?: 'Unspecified'; $reasons[$k] = ($reasons[$k] ?? 0) + (int)$x['n']; }
    arsort($reasons);
    // Limits being hit right now.
    $press = [];
    if (a_has('bc_rate')) {
        $lim = ['gm:m' => [10, 60, 'messages / minute'], 'gm:h' => [120, 3600, 'messages / hour'], 'gm:d' => [400, 86400, 'messages / day'],
                'ga:h' => [15, 3600, 'AI replies / hour'], 'ga:d' => [60, 86400, 'AI replies / day'], 'gao:h' => [150, 3600, 'AI replies to all guests / hour'], 'gao:d' => [1000, 86400, 'AI replies to all guests / day']];
        foreach (a_rows("SELECT k, win_start, n FROM bc_rate WHERE (k LIKE 'gm:%' OR k LIKE 'ga:%' OR k LIKE 'gao:%') AND win_start > ?", [time() - 86400]) as $x) {
            if (!preg_match('/^(gm|ga|gao):(\d+):([mhd])$/', (string)$x['k'], $m)) continue;
            $L = $lim[$m[1] . ':' . $m[3]] ?? null;
            if (!$L || (int)$x['win_start'] <= time() - $L[1]) continue;
            $pct = (int)$x['n'] / $L[0];
            if ($pct < 0.5) continue;
            $press[] = ['acc' => a_acc_brief($all[(int)$m[2]] ?? null) ?: ['id' => (int)$m[2], 'name' => '#' . $m[2]], 'what' => $L[2], 'n' => (int)$x['n'], 'max' => $L[0], 'pct' => round($pct * 100)];
        }
        usort($press, fn($x, $y) => $y['pct'] <=> $x['pct']);
    }
    // Customers operators have blocked, per account.
    $blocked = [];
    if (a_has('bc_end_users')) foreach (a_rows("SELECT account_id a, COUNT(*) n FROM bc_end_users WHERE is_blocked=1 GROUP BY account_id ORDER BY n DESC LIMIT 10") as $x) $blocked[] = ['acc' => a_acc_brief($all[(int)$x['a']] ?? null), 'n' => (int)$x['n']];
    $lv = ['high' => 0, 'medium' => 0, 'low' => 0];
    foreach ($rows as $x) if (isset($lv[$x['level']])) $lv[$x['level']]++;
    return ['rows' => array_slice($rows, 0, 300), 'levels' => $lv, 'clusters' => $cl, 'cooldowns' => $cool, 'reasons' => $reasons, 'pressure' => array_slice($press, 0, 40), 'blocked' => $blocked];
}

function api_ai(array $q): array {
    $r = a_range($q['range'] ?? '30d');
    $has = a_has('bc_llm_usage');
    $since = $has ? a_val("SELECT MIN(created_at) FROM bc_llm_usage", [], null) : null;
    $b = a_b('created_at', $r);
    $tot = ['calls' => 0, 'errors' => 0, 'in' => 0, 'out' => 0, 'cached' => 0, 'cost' => 0.0, 'lat' => 0, 'est' => 0];
    $byProv = []; $byModel = []; $byPurpose = []; $dayCost = []; $dayCalls = []; $dayErr = [];
    if ($has) {
        foreach (a_rows("SELECT $b b, provider, model, purpose, COUNT(*) n, SUM(ok=0) e, SUM(input_tokens) i, SUM(cached_tokens) c, SUM(output_tokens) o,
                                SUM(latency_ms) l, SUM(estimated) est
                           FROM bc_llm_usage WHERE created_at >= ? AND " . a_llm_where() . " GROUP BY b, provider, model, purpose", [$r['from']]) as $x) {
            $c = a_cost((string)$x['model'], (string)$x['provider'], (float)$x['i'], (float)$x['c'], (float)$x['o']);
            $n = (int)$x['n'];
            $tot['calls'] += $n; $tot['errors'] += (int)$x['e']; $tot['in'] += (int)$x['i']; $tot['out'] += (int)$x['o']; $tot['cached'] += (int)$x['c'];
            $tot['cost'] += $c; $tot['lat'] += (int)$x['l']; $tot['est'] += (int)$x['est'];
            $p = (string)$x['provider'];
            $dayCost[$p][$x['b']] = ($dayCost[$p][$x['b']] ?? 0) + $c;
            $dayCalls[$x['b']] = ($dayCalls[$x['b']] ?? 0) + $n;
            $dayErr[$x['b']] = ($dayErr[$x['b']] ?? 0) + (int)$x['e'];
            $bump = function (array &$m, string $k) use ($p, $n, $x, $c) {
                $m[$k] = $m[$k] ?? ['key' => $k, 'provider' => $p, 'calls' => 0, 'errors' => 0, 'in' => 0, 'out' => 0, 'cost' => 0.0, 'lat' => 0];
                $m[$k]['calls'] += $n; $m[$k]['errors'] += (int)$x['e']; $m[$k]['in'] += (int)$x['i']; $m[$k]['out'] += (int)$x['o'];
                $m[$k]['cost'] += $c; $m[$k]['lat'] += (int)$x['l'];
            };
            $bump($byProv, $p);
            $bump($byModel, (string)$x['model']);
            $bump($byPurpose, a_purpose_label((string)$x['purpose']));
        }
    }
    $sortc = function (array $m) { $m = array_values($m); usort($m, fn($x, $y) => $y['cost'] <=> $x['cost'] ?: $y['calls'] <=> $x['calls']); return $m; };
    foreach ($byModel as $k => $v) { $pr = a_price_for($k, $v['provider']); $byModel[$k]['price'] = $pr; }
    $all = a_accounts_all();
    $per = [];
    foreach (a_llm_by_account($r['from']) as $a => $v) {
        $per[] = ['acc' => a_acc_brief($all[$a] ?? null) ?: ['id' => $a, 'name' => $a ? '#' . $a : 'Unattributed', 'guest' => false],
                  'calls' => $v['calls'], 'errors' => $v['errors'], 'in' => $v['in'], 'out' => $v['out'], 'cost' => round($v['cost'], 5),
                  'lat' => $v['calls'] ? (int)round($v['lat'] / $v['calls']) : 0, 'models' => $v['models']];
    }
    usort($per, fn($x, $y) => $y['cost'] <=> $x['cost']);
    $errs = $has ? a_rows("SELECT account_id, provider, model, purpose, error, latency_ms, created_at FROM bc_llm_usage WHERE ok=0 AND " . a_llm_where() . " ORDER BY id DESC LIMIT 40") : [];
    foreach ($errs as &$e) { $e['who'] = a_name_of((int)$e['account_id']); $e['purpose'] = a_purpose_label((string)$e['purpose']); }
    unset($e);
    // What accounts have set up.
    $setup = ['keys' => ['gemini' => 0, 'openai' => 0, 'claude' => 0], 'active' => [], 'agent_models' => []];
    foreach (a_rows("SELECT `key` k, COUNT(DISTINCT account_id) n FROM bc_credentials WHERE `key` IN ('llm_gemini','llm_openai','llm_claude') AND value <> '' GROUP BY `key`") as $x) $setup['keys'][substr($x['k'], 4)] = (int)$x['n'];
    foreach (a_rows("SELECT value v, COUNT(*) n FROM bc_credentials WHERE `key`='llm_active' AND value <> '' GROUP BY value") as $x) $setup['active'][$x['v']] = (int)$x['n'];
    foreach (a_rows("SELECT model v, COUNT(*) n FROM bc_agents WHERE active=1 GROUP BY model ORDER BY n DESC LIMIT 10") as $x) $setup['agent_models'][(string)$x['v'] ?: '(default)'] = (int)$x['n'];
    $provSeries = [];
    foreach (['gemini', 'openai', 'claude'] as $p) $provSeries[$p] = array_map(fn($v) => round($v, 5), a_fill($r, $dayCost[$p] ?? [], 0.0));
    $days = max(1, $r['hourly'] ? 1 : min($r['days'], $since ? max(1, (int)ceil((strtotime(a_now()) - strtotime((string)$since)) / 86400)) : $r['days']));
    return [
        'range' => $r['key'], 'tracking_since' => $since, 'paused' => (string)a_setting('llm_pause', '0') === '1',
        'scope' => a_ai_scope(), 'builtin' => a_builtin() + ['users' => a_builtin_users(), 'price' => a_price_for(a_builtin()['model'], a_builtin()['provider'])],
        'totals' => $tot + ['avg_lat' => $tot['calls'] ? (int)round($tot['lat'] / $tot['calls']) : 0, 'per_day' => $tot['cost'] / $days, 'projected_month' => $tot['cost'] / $days * 30],
        'series' => ['labels' => $r['buckets'], 'cost' => $provSeries, 'calls' => a_fill($r, $dayCalls), 'errors' => a_fill($r, $dayErr)],
        'providers' => $sortc($byProv), 'models' => $sortc($byModel), 'purposes' => $sortc($byPurpose),
        'accounts' => array_slice($per, 0, 150), 'errors' => $errs, 'setup' => $setup,
    ];
}

function api_revenue(array $q): array {
    $r = a_range($q['range'] ?? '30d');
    $rows = a_sales_rows($r['from']);
    $all = a_accounts_all();
    $take = (float)a_setting('take_rate', 0);
    $day = []; $dayN = []; $byCur = []; $byAcc = []; $byProd = []; $byCh = [];
    $tot = ['usd' => 0.0, 'orders' => 0, 'other' => 0, 'unpaid' => 0, 'customers' => []];
    foreach ($rows as $x) {
        if (!$x['paid']) { $tot['unpaid']++; continue; }
        $bk = $r['hourly'] ? substr((string)$x['created_at'], 0, 13) . ':00' : substr((string)$x['created_at'], 0, 10);
        $u = $x['usd'];
        $cur = strtoupper((string)$x['currency']) ?: 'USD';
        $amt = (float)a_amount($x['amount']);
        $byCur[$cur] = $byCur[$cur] ?? ['cur' => $cur, 'amount' => 0.0, 'usd' => 0.0, 'n' => 0, 'converted' => $u !== null];
        $byCur[$cur]['amount'] += $amt; $byCur[$cur]['usd'] += (float)$u; $byCur[$cur]['n']++;
        $tot['orders']++;
        $tot['customers'][$x['account_id'] . ':' . $x['end_user_id']] = true;
        $dayN[$bk] = ($dayN[$bk] ?? 0) + 1;
        if ($u === null) { $tot['other']++; continue; }
        $tot['usd'] += $u;
        $day[$bk] = ($day[$bk] ?? 0) + $u;
        $a = (int)$x['account_id'];
        $byAcc[$a] = $byAcc[$a] ?? ['usd' => 0.0, 'n' => 0];
        $byAcc[$a]['usd'] += $u; $byAcc[$a]['n']++;
        $pk = ($x['product'] ?: 'Custom order') . '|' . $a;
        $byProd[$pk] = $byProd[$pk] ?? ['name' => $x['product'] ?: 'Custom order', 'acc' => a_acc_brief($all[$a] ?? null), 'usd' => 0.0, 'n' => 0];
        $byProd[$pk]['usd'] += $u; $byProd[$pk]['n']++;
        $ch = (string)($x['channel'] ?: 'other');
        $byCh[$ch] = ($byCh[$ch] ?? 0) + $u;
    }
    $accRows = [];
    foreach ($byAcc as $a => $v) $accRows[] = ['acc' => a_acc_brief($all[$a] ?? null) ?: ['id' => $a, 'name' => '#' . $a], 'usd' => round($v['usd'], 2), 'n' => $v['n'], 'earn' => round($v['usd'] * $take / 100, 2)];
    usort($accRows, fn($x, $y) => $y['usd'] <=> $x['usd']);
    $prod = array_values($byProd);
    usort($prod, fn($x, $y) => $y['usd'] <=> $x['usd']);
    // Invoices: made, paid, still open.
    $inv = a_invoices($r['from']);
    $fun = ['created' => count($inv), 'confirmed' => 0, 'pending' => 0, 'cancelled' => 0, 'expired' => 0, 'other' => 0, 'pending_usd' => 0.0, 'confirmed_usd' => 0.0];
    $coins = [];
    foreach ($inv as $i) {
        $k = isset($fun[$i['status']]) && $i['status'] !== 'created' ? $i['status'] : 'other';
        $fun[$k]++;
        if ($i['status'] === 'pending') $fun['pending_usd'] += (float)$i['usd'];
        if ($i['status'] === 'confirmed') { $fun['confirmed_usd'] += (float)$i['usd']; $coins[$i['coin'] ?: '?'] = ($coins[$i['coin'] ?: '?'] ?? 0) + 1; }
    }
    arsort($coins);
    $llmCost = 0.0;
    foreach (a_llm_by_account($r['from']) as $v) $llmCost += $v['cost'];
    $recent = array_slice($rows, 0, 30);
    foreach ($recent as &$x) $x['acc'] = a_acc_brief($all[(int)$x['account_id']] ?? null);
    unset($x);
    return [
        'range' => $r['key'], 'take_rate' => $take,
        'totals' => ['usd' => round($tot['usd'], 2), 'orders' => $tot['orders'], 'aov' => $tot['orders'] - $tot['other'] > 0 ? $tot['usd'] / ($tot['orders'] - $tot['other']) : 0,
                     'customers' => count($tot['customers']), 'sellers' => count($byAcc), 'other' => $tot['other'], 'unpaid' => $tot['unpaid'],
                     'earn' => round($tot['usd'] * $take / 100, 2), 'llm_cost' => round($llmCost, 4), 'llm_scope' => a_ai_scope()],
        'series' => ['labels' => $r['buckets'], 'usd' => array_map(fn($v) => round($v, 2), a_fill($r, $day, 0.0)), 'orders' => a_fill($r, $dayN)],
        'currencies' => array_values($byCur), 'accounts' => array_slice($accRows, 0, 50), 'products' => array_slice($prod, 0, 20),
        'channels' => $byCh, 'invoices' => $fun, 'coins' => $coins, 'recent' => $recent,
    ];
}

function api_messages(array $q): array {
    $r = a_range($q['range'] ?? '7d');
    $ch = a_channels_series($r);
    $heat = array_fill(0, 7, array_fill(0, 24, 0));
    $from = $r['days'] > 30 ? a_ago_sql(30 * 86400) : $r['from'];
    if (a_has('bc_messages')) foreach (a_rows("SELECT WEEKDAY(created_at) d, HOUR(created_at) h, COUNT(*) n FROM bc_messages WHERE created_at >= ? AND LEFT(conv_id,3) <> 'dm_' GROUP BY d, h", [$from]) as $x) $heat[(int)$x['d']][(int)$x['h']] += (int)$x['n'];
    if (a_has('bc_dm_messages')) foreach (a_rows("SELECT WEEKDAY(created_at) d, HOUR(created_at) h, COUNT(*) n FROM bc_dm_messages WHERE id >= ? GROUP BY d, h", [a_dm_id_since($from)]) as $x) $heat[(int)$x['d']][(int)$x['h']] += (int)$x['n'];
    $fail = a_col('bc_messages', 'send_failed') ? (int)a_val("SELECT COUNT(*) FROM bc_messages WHERE created_at >= ? AND send_failed=1", [$r['from']]) : 0;
    $outboxFail = 0;
    if (a_has('bc_bot_outbox')) $outboxFail += (int)a_val("SELECT COUNT(*) FROM bc_bot_outbox WHERE failed=1 AND created_at >= ?", [$r['from']]);
    if (a_has('bc_dm_outbox')) $outboxFail += (int)a_val("SELECT COUNT(*) FROM bc_dm_outbox WHERE failed=1 AND created_at >= ?", [$r['from']]);
    // Busiest conversations.
    $busy = [];
    if (a_has('bc_messages')) foreach (a_rows("SELECT m.account_id, m.conv_id, COUNT(*) n, c.name, c.platform FROM bc_messages m
                                                 LEFT JOIN bc_conversations c ON c.account_id=m.account_id AND c.id=m.conv_id
                                                WHERE m.created_at >= ? AND LEFT(m.conv_id,3) <> 'dm_' GROUP BY m.account_id, m.conv_id ORDER BY n DESC LIMIT 12", [$r['from']]) as $x) {
        $busy[] = ['acc' => a_acc_brief(a_accounts_all()[(int)$x['account_id']] ?? null), 'conv' => $x['conv_id'], 'name' => $x['name'] ?: $x['conv_id'], 'platform' => $x['platform'] ?: 'telegram', 'n' => (int)$x['n']];
    }
    // Latest messages: one line per conversation — its newest message (that
    // matches the search / filter), how many it had in 30 days — newest
    // conversation first, a page at a time.
    $needle = trim((string)($q['q'] ?? ''));
    $role = (string)($q['role'] ?? '');
    $per = 15;
    $page = max(1, (int)($q['page'] ?? 1));
    $w = ["m.created_at >= ?", "LEFT(m.conv_id,3) <> 'dm_'"]; $p = [a_ago_sql(30 * 86400)];
    if ($needle !== '') { $w[] = 'm.content LIKE ?'; $p[] = '%' . addcslashes($needle, '%_\\') . '%'; }
    if (in_array($role, ['in', 'out'], true)) { $w[] = $role === 'in' ? "m.role='in'" : "m.role<>'in'"; }
    if ($role === 'ai' && a_col('bc_messages', 'agent_name')) $w[] = "m.role<>'in' AND m.agent_name<>''";
    $where = implode(' AND ', $w);
    $convs = []; $convTotal = 0;
    if (a_has('bc_messages')) {
        $convTotal = (int)a_val("SELECT COUNT(*) FROM (SELECT 1 FROM bc_messages m WHERE $where GROUP BY m.account_id, m.conv_id) x", $p);
        $pages = max(1, (int)ceil($convTotal / $per));
        $page = min($page, $pages);
        $groups = a_rows("SELECT m.account_id, m.conv_id, COUNT(*) n, SUM(m.role='in') n_in, MAX(m.id) last_id
                            FROM bc_messages m WHERE $where GROUP BY m.account_id, m.conv_id
                           ORDER BY last_id DESC LIMIT $per OFFSET " . (($page - 1) * $per), $p);
        if ($groups) {
            $ids = array_map(fn($g) => (int)$g['last_id'], $groups);
            $last = [];
            foreach (a_rows("SELECT m.id, m.role, LEFT(m.content, 300) content, m.media_type, " . (a_col('bc_messages', 'agent_name') ? 'm.agent_name' : "''") . " agent_name, m.created_at,
                                    c.name cname, c.handle, c.platform
                               FROM bc_messages m LEFT JOIN bc_conversations c ON c.account_id=m.account_id AND c.id=m.conv_id
                              WHERE m.id IN (" . implode(',', $ids) . ")") as $x) $last[(int)$x['id']] = $x;
            $all = a_accounts_all();
            foreach ($groups as $g) {
                $x = $last[(int)$g['last_id']] ?? null;
                if (!$x) continue;
                $convs[] = ['account_id' => (int)$g['account_id'], 'conv_id' => $g['conv_id'], 'n' => (int)$g['n'], 'n_in' => (int)$g['n_in'],
                            'owner' => a_acc_brief($all[(int)$g['account_id']] ?? null), 'name' => $x['cname'] ?: $g['conv_id'], 'handle' => (string)($x['handle'] ?? ''),
                            'platform' => $x['platform'] ?: 'telegram', 'role' => $x['role'], 'agent_name' => $x['agent_name'], 'content' => $x['content'],
                            'media_type' => $x['media_type'], 'created_at' => $x['created_at']];
            }
        }
    }
    $sum = fn($a) => array_sum($a);
    return [
        'range' => $r['key'],
        'totals' => ['telegram' => $sum($ch['telegram']), 'discord' => $sum($ch['discord']), 'direct' => $sum($ch['direct']), 'ai' => $sum($ch['ai']),
                     'inbound' => $sum($ch['inbound']), 'outbound' => $sum($ch['outbound']), 'failed' => $fail, 'outbox_failed' => $outboxFail],
        'series' => ['labels' => $r['buckets']] + $ch, 'heat' => $heat, 'busy' => $busy,
        'convs' => $convs, 'conv_total' => $convTotal, 'page' => $page, 'pages' => max(1, (int)ceil($convTotal / $per)), 'per' => $per,
    ];
}

function api_system(): array {
    $tables = a_rows("SELECT TABLE_NAME name, TABLE_ROWS n, DATA_LENGTH d, INDEX_LENGTH i FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC");
    $size = 0; foreach ($tables as $t) $size += (int)$t['d'] + (int)$t['i'];
    $relay = ['on' => 0, 'off' => 0, 'erroring' => 0, 'stale' => 0, 'desktop' => 0, 'rows' => []];
    foreach (a_bot_rows() as $x) {
        if ((int)$x['on_flag']) $relay['on']++; else $relay['off']++;
        if ($x['state'] === 'erroring') $relay['erroring']++;
        if ($x['state'] === 'desktop') $relay['desktop']++;
        // Not polled lately — only counts while the server is the one receiving.
        if ($x['state'] === 'on' || $x['state'] === 'erroring') { if ($x['since_poll'] === null || (int)$x['since_poll'] > 300) $relay['stale']++; }
        $x['acc'] = a_acc_brief(a_accounts_all()[(int)$x['account_id']] ?? null);
        $relay['rows'][] = $x;
    }
    $q = [];
    $cnt = function (string $t, string $label, string $sql) use (&$q) { if (a_has($t)) $q[] = ['label' => $label, 'n' => (int)a_val($sql)]; };
    $cnt('bc_bot_jobs', 'Bot replies waiting', "SELECT COUNT(*) FROM bc_bot_jobs WHERE due_at <= NOW()");
    $cnt('bc_bot_jobs', 'Bot replies overdue > 5 min', "SELECT COUNT(*) FROM bc_bot_jobs WHERE due_at <= NOW() - INTERVAL 5 MINUTE");
    $cnt('bc_dm_ai_jobs', 'Direct-chat replies waiting', "SELECT COUNT(*) FROM bc_dm_ai_jobs WHERE due_at <= NOW()");
    $cnt('bc_dm_ai_jobs', 'Direct-chat replies overdue > 5 min', "SELECT COUNT(*) FROM bc_dm_ai_jobs WHERE due_at <= NOW() - INTERVAL 5 MINUTE");
    $cnt('bc_bot_outbox', 'Bot messages to send', "SELECT COUNT(*) FROM bc_bot_outbox WHERE sent_at IS NULL AND failed=0");
    $cnt('bc_bot_outbox', 'Bot messages failed (24h)', "SELECT COUNT(*) FROM bc_bot_outbox WHERE failed=1 AND created_at >= NOW() - INTERVAL 1 DAY");
    $cnt('bc_dm_outbox', 'Direct messages to send', "SELECT COUNT(*) FROM bc_dm_outbox WHERE sent_at IS NULL AND failed=0");
    $cnt('bc_dm_outbox', 'Direct messages failed (24h)', "SELECT COUNT(*) FROM bc_dm_outbox WHERE failed=1 AND created_at >= NOW() - INTERVAL 1 DAY");
    $cnt('bc_scheduled_actions', 'Scheduled actions pending', "SELECT COUNT(*) FROM bc_scheduled_actions WHERE status='pending'");
    $cnt('bc_scheduled_actions', 'Scheduled actions overdue', "SELECT COUNT(*) FROM bc_scheduled_actions WHERE status='pending' AND run_at < UTC_TIMESTAMP() - INTERVAL 10 MINUTE");
    $cnt('bc_scheduled_actions', 'Scheduled actions failed (7d)', "SELECT COUNT(*) FROM bc_scheduled_actions WHERE status='failed' AND updated_at >= NOW() - INTERVAL 7 DAY");
    $cnt('bc_dm_pay_watch', 'Invoices being watched', "SELECT COUNT(*) FROM bc_dm_pay_watch");
    $cnt('bc_dm_files', 'Direct-chat files stored', "SELECT COUNT(*) FROM bc_dm_files");
    $mem = ['files' => 0, 'bytes' => 0, 'capped' => false];
    $dir = __DIR__ . '/memory';
    if (is_dir($dir) && ($h = @opendir($dir))) {
        while (($f = readdir($h)) !== false) {
            if ($f[0] === '.') continue;
            $mem['files']++; $mem['bytes'] += (int)@filesize($dir . '/' . $f);
            if ($mem['files'] >= 50000) { $mem['capped'] = true; break; }
        }
        closedir($h);
    }
    $log = '';
    $lf = __DIR__ . '/migrate.log';
    if (is_readable($lf)) { $sz = filesize($lf); $fh = fopen($lf, 'r'); if ($sz > 6000) fseek($fh, -6000, SEEK_END); $log = (string)stream_get_contents($fh); fclose($fh); }
    $llm = a_has('bc_llm_usage') ? a_row("SELECT COUNT(*) n, SUM(ok=0) e, AVG(latency_ms) l FROM bc_llm_usage WHERE created_at >= ?", [a_ago_sql(3600)]) : [];
    return [
        'db' => ['size' => $size, 'version' => a_val("SELECT VERSION()", [], ''), 'time' => a_now(), 'tables' => array_slice($tables, 0, 40)],
        'php' => ['version' => PHP_VERSION, 'memory_limit' => ini_get('memory_limit'), 'max_exec' => ini_get('max_execution_time'), 'post_max' => ini_get('post_max_size'),
                  'time' => date('Y-m-d H:i:s'), 'tz' => date_default_timezone_get(), 'disk_free' => function_exists('disk_free_space') ? (@disk_free_space(__DIR__) ?: null) : null, 'curl' => function_exists('curl_init'),
                  'api_patched' => a_api_patched()],
        'relay' => $relay, 'queues' => $q, 'memory' => $mem, 'migrate_log' => $log,
        'llm_hour' => ['calls' => (int)($llm['n'] ?? 0), 'errors' => (int)($llm['e'] ?? 0), 'lat' => (int)($llm['l'] ?? 0)],
        'paused' => (string)a_setting('llm_pause', '0') === '1',
    ];
}
function a_api_patched(): bool {
    $f = __DIR__ . '/' . ADMIN_API_FILE;
    if (!is_readable($f)) return false;
    return strpos((string)file_get_contents($f), 'function bc_llm_log(') !== false;
}

function api_boot(): array {
    $g = a_c('bc_accounts', 'is_guest', '0');
    $r = a_row("SELECT SUM($g=0) a, SUM($g=1) g FROM bc_accounts");
    $high = 0;
    foreach (a_risk_all() as $v) if ($v['score'] >= 60) $high++;
    return ['accounts' => (int)($r['a'] ?? 0), 'guests' => (int)($r['g'] ?? 0), 'risk_high' => $high,
            'paused' => (string)a_setting('llm_pause', '0') === '1', 'api_patched' => a_api_patched()];
}

function api_audit(): array {
    $rows = a_rows("SELECT id, action, target_id, detail, ip, created_at FROM bc_admin_audit ORDER BY id DESC LIMIT 400");
    $all = a_accounts_all();
    foreach ($rows as &$r) $r['target'] = $r['target_id'] ? (a_acc_brief($all[(int)$r['target_id']] ?? null) ?: ['id' => (int)$r['target_id'], 'name' => '#' . $r['target_id'] . ' (deleted)']) : null;
    unset($r);
    return ['rows' => $rows];
}

function api_settings(): array {
    $p = [];
    foreach (a_prices() as $m => $v) $p[] = ['model' => $m] + $v + ['custom' => !isset(A_DEFAULT_PRICES[$m])];
    $seen = [];
    if (a_has('bc_llm_usage')) foreach (a_rows("SELECT DISTINCT provider, model FROM bc_llm_usage WHERE created_at >= ?", [a_ago_sql(90 * 86400)]) as $x) {
        $pr = a_price_for((string)$x['model'], (string)$x['provider']);
        if (!empty($pr['guess'])) $seen[] = $x;
    }
    return [
        'prices' => $p, 'unpriced' => $seen, 'fx' => a_fx(), 'take_rate' => (float)a_setting('take_rate', 0),
        'refresh' => (int)a_setting('refresh_sec', 15), 'paused' => (string)a_setting('llm_pause', '0') === '1',
        'builtin' => a_builtin() + ['users' => a_builtin_users()], 'ai_scope' => a_ai_scope(),
        'security' => ['username' => ADMIN_USERNAME, 'hashed' => ADMIN_PASSWORD_HASH !== '', 'allowlist' => count(ADMIN_IP_ALLOWLIST), 'hours' => ADMIN_SESSION_HOURS,
                       'idle' => ADMIN_IDLE_MINUTES, 'https' => $GLOBALS['A_HTTPS'], 'ip' => a_ip()],
    ];
}

function api_search(string $q): array {
    $q = trim($q);
    if ($q === '') return ['rows' => []];
    $out = [];
    $n = mb_strtolower(ltrim($q, '#@'));
    foreach (a_accounts_all() as $id => $a) {
        $hay = mb_strtolower($id . ' ' . $a['username'] . ' ' . $a['display_name'] . ' ' . (empty($a['is_guest']) ? $a['email'] : ''));
        if ((string)$id === $n || mb_strpos($hay, $n) !== false) $out[] = a_acc_brief($a);
        if (count($out) >= 12) break;
    }
    return ['rows' => $out];
}

function api_export(string $what, array $q): void {
    $fn = 'booqi-' . $what . '-' . date('Ymd-His') . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $fn . '"');
    $o = fopen('php://output', 'w');
    fwrite($o, "\xEF\xBB\xBF");
    if ($what === 'accounts') {
        $all = api_accounts(['type' => 'all', 'sort' => 'id', 'dir' => 'asc', 'page' => 1]);
        fputcsv($o, ['id', 'username', 'name', 'email', 'type', 'suspended', 'created', 'last_seen', 'messages_30d', 'ai_replies_30d', 'ai_cost_30d_usd', 'sales_usd', 'orders', 'conversations', 'bots_on', 'risk']);
        $pages = $all['pages'];
        for ($pg = 1; $pg <= $pages; $pg++) {
            $d = api_accounts(['type' => 'all', 'sort' => 'id', 'dir' => 'asc', 'page' => $pg]);
            foreach ($d['rows'] as $r) fputcsv($o, [$r['id'], $r['username'], $r['name'], $r['email'], $r['guest'] ? 'guest' : 'account', $r['suspended'] ? 'yes' : '', $r['created'], $r['seen'],
                                                    $r['msgs'], $r['ai'], $r['cost'], $r['sales'], $r['orders'], $r['convs'], $r['bots'], $r['risk']]);
        }
    } elseif ($what === 'ai') {
        $r = a_range($q['range'] ?? '30d');
        fputcsv($o, ['date', 'account_id', 'account', 'provider', 'model', 'purpose', 'calls', 'errors', 'input_tokens', 'cached_tokens', 'output_tokens', 'cost_usd']);
        if (a_has('bc_llm_usage')) foreach (a_rows("SELECT DATE(created_at) d, account_id, provider, model, purpose, COUNT(*) n, SUM(ok=0) e, SUM(input_tokens) i, SUM(cached_tokens) c, SUM(output_tokens) o
                                                      FROM bc_llm_usage WHERE created_at >= ? AND " . a_llm_where() . " GROUP BY d, account_id, provider, model, purpose ORDER BY d, account_id", [$r['from']]) as $x) {
            fputcsv($o, [$x['d'], $x['account_id'], a_name_of((int)$x['account_id']), $x['provider'], $x['model'], a_purpose_label((string)$x['purpose']), $x['n'], $x['e'], $x['i'], $x['c'], $x['o'],
                         round(a_cost((string)$x['model'], (string)$x['provider'], (float)$x['i'], (float)$x['c'], (float)$x['o']), 6)]);
        }
    } elseif ($what === 'sales') {
        $r = a_range($q['range'] ?? '365d');
        fputcsv($o, ['id', 'date', 'account_id', 'seller', 'customer', 'channel', 'product', 'amount', 'currency', 'usd', 'status', 'reference']);
        foreach (a_sales_rows($r['from']) as $x) fputcsv($o, [$x['id'], $x['created_at'], $x['account_id'], a_name_of((int)$x['account_id']), $x['customer'], $x['channel'], $x['product'], $x['amount'], $x['currency'], $x['usd'] === null ? '' : round($x['usd'], 2), $x['status'], $x['reference']]);
    }
    fclose($o);
    exit;
}

// ══ ACTIONS ══════════════════════════════════════════════════

function a_account_or_fail(int $id): array {
    $a = a_row("SELECT " . a_acc_cols() . " FROM bc_accounts WHERE id=?", [$id]);
    if (!$a) a_fail('That account no longer exists.', 404);
    return $a;
}

// Removes an account and everything it owns. Figures already counted in
// the AI usage ledger stay (they're what was spent), unattached.
function a_delete_account(int $id): array {
    $pdo = a_pdo();
    $n = [];
    $del = function (string $label, string $sql, array $p) use ($pdo, &$n) {
        try { $s = $pdo->prepare($sql); $s->execute($p); if ($s->rowCount()) $n[$label] = ($n[$label] ?? 0) + $s->rowCount(); }
        catch (Throwable $e) { a_warn($e, $sql); }
    };
    $tids = a_has('bc_dm_threads') ? array_map('intval', array_column(a_rows("SELECT id FROM bc_dm_threads WHERE a_id=? OR b_id=?", [$id, $id]), 'id')) : [];
    foreach (array_chunk($tids, 500) as $chunk) {
        $in = implode(',', $chunk);
        if (a_has('bc_dm_file_parts') && a_has('bc_dm_files')) $del('file parts', "DELETE p FROM bc_dm_file_parts p JOIN bc_dm_files f ON f.id = p.file_id WHERE f.thread_id IN ($in)", []);
        foreach (['bc_dm_files', 'bc_dm_messages', 'bc_dm_agent_env', 'bc_dm_ai', 'bc_dm_ai_jobs', 'bc_dm_outbox', 'bc_dm_typing'] as $t) {
            if (a_col($t, 'thread_id')) $del($t, "DELETE FROM $t WHERE thread_id IN ($in)", []);
        }
        $del('bc_dm_threads', "DELETE FROM bc_dm_threads WHERE id IN ($in)", []);
    }
    if (a_has('bc_dm_file_parts') && a_has('bc_dm_files')) $del('file parts', "DELETE p FROM bc_dm_file_parts p JOIN bc_dm_files f ON f.id = p.file_id WHERE f.uploader = ?", [$id]);
    if (a_has('bc_dm_files')) $del('bc_dm_files', "DELETE FROM bc_dm_files WHERE uploader = ?", [$id]);
    foreach (a_schema() as $t => $cols) {
        if (strpos($t, 'bc_') !== 0 || in_array($t, ['bc_accounts', 'bc_llm_usage', 'bc_admin_audit', 'bc_admin_settings', 'bc_rate'], true)) continue;
        if (isset($cols['account_id'])) $del($t, "DELETE FROM `$t` WHERE account_id = ?", [$id]);
        elseif (isset($cols['owner_id'])) $del($t, "DELETE FROM `$t` WHERE owner_id = ?", [$id]);
    }
    if (a_has('bc_rate')) $del('limits', "DELETE FROM bc_rate WHERE k LIKE ? OR k LIKE ? OR k LIKE ?", ["gm:$id:%", "ga:$id:%", "gao:$id:%"]);
    $del('account', "DELETE FROM bc_accounts WHERE id = ?", [$id]);
    return $n;
}

// Signs this browser in to the app as the account (a fresh app session).
function a_impersonate(int $id): void {
    session_write_close();
    $sid = bin2hex(random_bytes(20));
    ini_set('session.use_cookies', '0');
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    session_name('bc_sess');
    session_id($sid);
    session_start();
    $_SESSION = ['account_id' => $id, 'admin_view' => time()];
    session_write_close();
    setcookie('bc_sess', $sid, ['expires' => time() + 60 * 60 * 24 * 30, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'None']);
}

function a_action(string $act, array $b): array {
    $id = (int)($b['id'] ?? 0);
    switch ($act) {
        case 'suspend': {
            $a = a_account_or_fail($id);
            $why = mb_substr(trim((string)($b['reason'] ?? '')), 0, 250);
            a_exec("UPDATE bc_accounts SET suspended_at=NOW(), suspend_reason=? WHERE id=?", [$why !== '' ? $why : null, $id]);
            a_audit('suspend', $id, 'Suspended ' . ($a['display_name'] ?: $a['username']) . ($why !== '' ? " — $why" : ''));
            return ['ok' => true];
        }
        case 'unsuspend': {
            $a = a_account_or_fail($id);
            a_exec("UPDATE bc_accounts SET suspended_at=NULL, suspend_reason=NULL WHERE id=?", [$id]);
            a_audit('unsuspend', $id, 'Lifted the suspension on ' . ($a['display_name'] ?: $a['username']));
            return ['ok' => true];
        }
        case 'delete_account': {
            $a = a_account_or_fail($id);
            if (trim((string)($b['confirm'] ?? '')) !== (string)$a['username']) a_fail('Type the username exactly to confirm.');
            $n = a_delete_account($id);
            a_audit('delete', $id, 'Deleted ' . (!empty($a['is_guest']) ? 'guest ' : 'account ') . ($a['display_name'] ?: $a['username']) . ' (@' . $a['username'] . ')');
            return ['ok' => true, 'removed' => $n];
        }
        case 'impersonate': {
            $a = a_account_or_fail($id);
            if (!empty($a['suspended_at'])) a_fail('Lift the suspension first — suspended accounts can’t be opened.');
            a_audit('impersonate', $id, 'Opened the app as ' . ($a['display_name'] ?: $a['username']));
            a_impersonate($id);
            return ['ok' => true, 'url' => ADMIN_APP_URL];
        }
        case 'reset_password': {
            $a = a_account_or_fail($id);
            if (!empty($a['is_guest'])) a_fail('Guests don’t have a password.');
            $pw = (string)($b['password'] ?? '');
            if (strlen($pw) < 8) a_fail('Use at least 8 characters.');
            $set = "pass_hash=?" . (a_col('bc_accounts', 'pw_v') ? ", pw_v=1" : '');
            a_exec("UPDATE bc_accounts SET $set WHERE id=?", [password_hash($pw, PASSWORD_BCRYPT), $id]);
            a_audit('reset_password', $id, 'Set a new password for ' . ($a['display_name'] ?: $a['username']));
            return ['ok' => true];
        }
        case 'note': {
            a_account_or_fail($id);
            $note = mb_substr((string)($b['note'] ?? ''), 0, 5000);
            a_exec("INSERT INTO bc_admin_notes (account_id, note) VALUES (?,?) ON DUPLICATE KEY UPDATE note=VALUES(note)", [$id, $note]);
            return ['ok' => true];
        }
        case 'bots_off': {
            $a = a_account_or_fail($id);
            $n = a_has('bc_bot_relay') ? a_exec("UPDATE bc_bot_relay SET on_flag=0 WHERE account_id=?", [$id]) : 0;
            a_audit('bots_off', $id, 'Turned off the bots of ' . ($a['display_name'] ?: $a['username']));
            return ['ok' => true, 'n' => $n];
        }
        case 'clear_cooldowns': {
            $a = a_account_or_fail($id);
            $n = 0;
            if (a_col('bc_dm_ai', 'spam_hits')) $n += a_exec("UPDATE bc_dm_ai SET spam_hits=0, spam_until=NULL, spam_reason=NULL WHERE account_id=? AND (spam_hits<>0 OR spam_until IS NOT NULL)", [$id]);
            if (a_has('bc_bot_conv')) $n += a_exec("UPDATE bc_bot_conv SET spam_hits=0, spam_until=NULL, spam_reason=NULL WHERE account_id=? AND (spam_hits<>0 OR spam_until IS NOT NULL)", [$id]);
            a_audit('clear_cooldowns', $id, "Cleared $n spam " . ($n === 1 ? 'cooldown' : 'cooldowns') . " for " . ($a['display_name'] ?: $a['username']));
            return ['ok' => true, 'n' => $n];
        }
        case 'clear_limits': {
            $a = a_account_or_fail($id);
            $n = a_exec("DELETE FROM bc_rate WHERE k LIKE ? OR k LIKE ? OR k LIKE ?", ["gm:$id:%", "ga:$id:%", "gao:$id:%"]);
            a_audit('clear_limits', $id, 'Reset the message and AI limits of ' . ($a['display_name'] ?: $a['username']));
            return ['ok' => true, 'n' => $n];
        }
        case 'host_prefs': {
            $a = a_account_or_fail($id);
            if (!a_has('bc_dm_profile')) a_fail('Contact pages aren’t set up on this server yet.');
            a_exec("INSERT IGNORE INTO bc_dm_profile (account_id) VALUES (?)", [$id]);
            $set = []; $p = []; $what = [];
            foreach (['discoverable' => 'contact page', 'allow_guests' => 'guest chats', 'guest_ai' => 'agent replies to guests'] as $col => $label) {
                if (!array_key_exists($col, $b) || !a_col('bc_dm_profile', $col)) continue;
                $set[] = "$col=?"; $p[] = $b[$col] ? 1 : 0; $what[] = $label . ($b[$col] ? ' on' : ' off');
            }
            if (!$set) a_fail('Nothing to change.');
            $p[] = $id;
            a_exec("UPDATE bc_dm_profile SET " . implode(', ', $set) . " WHERE account_id=?", $p);
            a_audit('host_prefs', $id, 'Turned ' . implode(', ', $what) . ' for ' . ($a['display_name'] ?: $a['username']));
            return ['ok' => true];
        }
        case 'purge_guests': {
            $days = max(0, min(365, (int)($b['days'] ?? 3)));
            $mode = (string)($b['mode'] ?? 'silent');
            $g = a_c('bc_accounts', 'is_guest', '0');
            $cl = a_c('bc_accounts', 'claimed_at');
            $sql = "SELECT id FROM bc_accounts a WHERE $g=1 AND $cl IS NULL AND created_at < ?";
            if ($mode === 'silent' && a_has('bc_dm_messages')) $sql .= " AND NOT EXISTS (SELECT 1 FROM bc_dm_messages m WHERE m.sender_id=a.id) AND NOT EXISTS (SELECT 1 FROM bc_dm_messages m WHERE m.recipient_id=a.id)";
            $ids = array_map('intval', array_column(a_rows($sql . " ORDER BY id LIMIT 500", [a_ago_sql($days * 86400)]), 'id'));
            foreach ($ids as $gid) a_delete_account($gid);
            a_audit('purge_guests', null, 'Removed ' . count($ids) . ($mode === 'silent' ? ' silent' : ' unclaimed') . " guests older than $days days");
            return ['ok' => true, 'n' => count($ids), 'more' => count($ids) === 500];
        }
        case 'llm_pause': {
            $on = !empty($b['on']);
            a_setting_set('llm_pause', $on ? '1' : '0');
            a_audit('llm_pause', null, $on ? 'Paused all AI calls' : 'Resumed AI calls');
            return ['ok' => true, 'paused' => $on];
        }
        case 'ai_scope': {
            $sc = (string)($b['scope'] ?? '');
            if (!in_array($sc, ['builtin', 'own', 'all'], true)) a_fail('Unknown choice.');
            a_setting_set('ai_scope', $sc);
            return ['ok' => true, 'scope' => $sc];
        }
        case 'settings_save': {
            if (isset($b['builtin']) && is_array($b['builtin'])) {
                $bi = $b['builtin'];
                $was = a_builtin();
                $pv = in_array($bi['provider'] ?? '', A_PROVIDERS, true) ? (string)$bi['provider'] : $was['provider'];
                $model = trim((string)($bi['model'] ?? ''));
                if ($model !== '' && !preg_match('/^[A-Za-z0-9._:\-\/]{2,80}$/', $model)) a_fail('That model name doesn’t look right.');
                $key = trim((string)($bi['key'] ?? ''));
                if ($key !== '' && (strlen($key) < 10 || strlen($key) > 400 || preg_match('/\s/', $key))) a_fail('That API key doesn’t look right.');
                $on = !empty($bi['on']);
                if ($on && $key === '' && !$was['has_key'] && empty($bi['clear_key'])) a_fail('Add an API key before turning the built-in AI on.');
                a_setting_set('builtin_llm_provider', $pv);
                a_setting_set('builtin_llm_model', $model);
                if (!empty($bi['clear_key'])) { a_setting_set('builtin_llm_key', ''); $on = false; }
                elseif ($key !== '') a_setting_set('builtin_llm_key', $key);        // blank: keep the saved key
                a_setting_set('builtin_llm_on', $on ? '1' : '0');
                if ($on !== $was['on'] || $pv !== $was['provider'] || $model !== $was['model'] || $key !== '' || !empty($bi['clear_key'])) {
                    a_audit('builtin_llm', null, 'Built-in AI ' . ($on ? 'on' : 'off') . ' · ' . $pv . ($model !== '' ? ' ' . $model : '') . ($key !== '' ? ' · new key' : '') . (!empty($bi['clear_key']) ? ' · key removed' : ''));
                }
            }
            if (isset($b['prices']) && is_array($b['prices'])) {
                $out = [];
                foreach ($b['prices'] as $r) {
                    $m = trim((string)($r['model'] ?? ''));
                    if ($m === '' || !preg_match('/^[A-Za-z0-9._:\-\/]{2,80}$/', $m)) continue;
                    $out[$m] = ['provider' => in_array($r['provider'] ?? '', ['gemini', 'openai', 'claude'], true) ? $r['provider'] : 'gemini',
                                'in' => max(0, (float)($r['in'] ?? 0)), 'cached' => max(0, (float)($r['cached'] ?? 0)), 'out' => max(0, (float)($r['out'] ?? 0))];
                }
                foreach (A_DEFAULT_PRICES as $m => $v) if (!isset($out[$m])) $out[$m] = ['deleted' => true];
                a_setting_set('llm_prices', $out);
            }
            if (isset($b['fx']) && is_array($b['fx'])) {
                $fx = [];
                foreach ($b['fx'] as $k => $v) { $k = strtoupper(trim((string)$k)); if (preg_match('/^[A-Z]{2,6}$/', $k) && is_numeric($v) && (float)$v > 0) $fx[$k] = (float)$v; }
                a_setting_set('fx_rates', $fx);
            }
            if (isset($b['take_rate'])) a_setting_set('take_rate', (string)max(0, min(100, (float)$b['take_rate'])));
            if (isset($b['refresh'])) a_setting_set('refresh_sec', (string)max(5, min(300, (int)$b['refresh'])));
            a_audit('settings', null, 'Updated console settings');
            return ['ok' => true];
        }
    }
    a_fail('Unknown action.', 404);
    return [];
}

// ══ DISPATCH ═════════════════════════════════════════════════
if ($A_VIEW === 'app' && $A_IS_API) {
    $api = (string)$_GET['api'];
    $post = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
    if ($post) {
        if (!hash_equals(a_csrf(), (string)($_SERVER['HTTP_X_CSRF'] ?? ''))) a_fail('The page expired. Reload it and try again.', 403);
        $body = json_decode((string)file_get_contents('php://input'), true) ?: [];
        if ($api !== 'impersonate') session_write_close();
    } else {
        session_write_close();   // reads never hold the session lock
    }
    if (function_exists('set_time_limit')) @set_time_limit(90);
    try {
        if ($post) {
            if ($api === 'impersonate') { $res = a_action('impersonate', $body); a_json($res); }
            a_json(a_action($api, $body));
        }
        $q = $_GET;
        if ($api === 'export') api_export((string)($q['what'] ?? 'accounts'), $q);
        switch ($api) {
            case 'boot':         $res = api_boot(); break;
            case 'overview':     $res = api_overview(); break;
            case 'accounts':     $res = api_accounts($q); break;
            case 'account':      $res = api_account((int)($q['id'] ?? 0)); break;
            case 'conversation': $res = api_conversation((int)($q['acc'] ?? 0), (string)($q['conv'] ?? '')); break;
            case 'guests':       $res = api_guests($q); break;
            case 'risk':         $res = api_risk(); break;
            case 'ai':           $res = api_ai($q); break;
            case 'revenue':      $res = api_revenue($q); break;
            case 'messages':     $res = api_messages($q); break;
            case 'system':       $res = api_system(); break;
            case 'audit':        $res = api_audit(); break;
            case 'settings':     $res = api_settings(); break;
            case 'search':       $res = api_search((string)($q['q'] ?? '')); break;
            default:             $res = null;
        }
        if ($res === null) a_fail('Unknown view.', 404);
        $res['_now'] = a_now();
        if (!empty($GLOBALS['A_WARN'])) $res['_warn'] = array_slice(array_values(array_unique($GLOBALS['A_WARN'])), 0, 5);
        a_json($res);
    } catch (Throwable $e) {
        error_log('[admin] ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
        a_fail('Something went wrong: ' . $e->getMessage(), 500);
    }
}
if ($A_IS_API) a_fail('Signed out. Reload the page to sign in again.', 401);
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#020b10">
<title>booqi console</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%232dd4bf'/%3E%3Cstop offset='.55' stop-color='%230ea5e9'/%3E%3Cstop offset='1' stop-color='%234f46e5'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='32' cy='32' r='31' fill='url(%23g)'/%3E%3Cpath d='M22.5 15v27' stroke='%23fff' stroke-width='6' stroke-linecap='round'/%3E%3Ccircle cx='32' cy='37' r='9.5' fill='none' stroke='%23fff' stroke-width='6'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fredoka:wght@400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --fx1: #14b8a6; --fx2: #06b6d4; --fx3: #3b82f6;
  --b1: #020b10; --b2: #042029; --b3: #061831;
  --t1: #eef0f6; --t2: #9aa3b8; --t3: #66718a; --t4: #3d4658;
  --ln: rgba(255,255,255,.065); --ln2: rgba(255,255,255,.11);
  --glass: rgba(13,19,31,.66); --glass2: rgba(18,26,40,.78); --panel: rgba(9,14,24,.84);
  --ok: #30d158; --warn: #f5a524; --bad: #ff5d6c; --info: #7dd3fc;
  --c-tg: #38bdf8; --c-dc: #818cf8; --c-dm: #5eead4; --c-ai: #e9a8ff; --c-money: #86efac;
  --font: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  --r: 14px; --side: 240px;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; background: var(--b1); }
body { margin: 0; color: var(--t1); font: 400 13.5px/1.5 var(--font); -webkit-font-smoothing: antialiased; min-height: 100vh; }
a { color: inherit; text-decoration: none; }
button, input, select, textarea { font: inherit; color: inherit; }
svg { display: block; }
::selection { background: rgba(94,234,212,.28); }
.num, .mono { font-variant-numeric: tabular-nums; }
.mono { font-family: var(--mono); font-size: .92em; }
:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; border-radius: 6px; }

/* Ambient light, as on the landing page but calmer. */
.fx { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden;
  background: linear-gradient(125deg, var(--b1) 0%, var(--b2) 38%, var(--b3) 70%, var(--b1) 100%); }
.fx i { position: absolute; border-radius: 50%; filter: blur(100px); opacity: .38; }
.fx i:nth-child(1) { width: 44vw; height: 44vw; left: -12vw; top: -14vw; background: color-mix(in srgb, var(--fx1) 22%, transparent); animation: drift 30s ease-in-out infinite alternate; }
.fx i:nth-child(2) { width: 38vw; height: 38vw; right: -10vw; top: 10vh; background: color-mix(in srgb, var(--fx3) 20%, transparent); animation: drift 36s ease-in-out infinite alternate-reverse; }
.fx i:nth-child(3) { width: 34vw; height: 34vw; left: 32vw; bottom: -18vw; background: color-mix(in srgb, var(--fx2) 12%, transparent); animation: drift 42s ease-in-out infinite alternate; }
.fx::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 110% 90% at 50% 40%, transparent 35%, rgba(0,0,0,.55) 100%); }
@keyframes drift { to { transform: translate(5vw, 3vh) scale(1.06); } }

.word { font-family: 'Fredoka', var(--font); font-weight: 400; letter-spacing: -.01em; font-size: 24px; line-height: 1;
  background: linear-gradient(90deg, var(--fx1) 0%, var(--fx2) 28%, var(--fx3) 56%, #dfe6f0 72%, var(--fx1) 100%);
  background-size: 260% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: flow 9s ease-in-out infinite alternate; }
@keyframes flow { from { background-position: 0% 50%; } to { background-position: 100% 50%; } }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; padding: 0 13px; border-radius: 10px; border: 1px solid transparent;
  font: 600 12.5px/1 var(--font); white-space: nowrap; cursor: pointer; background: none; transition: background-color .15s, border-color .15s, box-shadow .2s, transform .1s; }
.btn:active { transform: translateY(1px); }
.btn svg { width: 14px; height: 14px; flex: none; }
.btn[disabled] { opacity: .5; pointer-events: none; }
.btn-p { color: #04151a; background: linear-gradient(135deg, #5eead4, #38bdf8 55%, #818cf8); box-shadow: 0 8px 22px -12px color-mix(in srgb, var(--fx2) 80%, transparent), inset 0 1px 0 rgba(255,255,255,.35); }
.btn-p:hover { box-shadow: 0 10px 28px -10px color-mix(in srgb, var(--fx2) 90%, transparent), inset 0 1px 0 rgba(255,255,255,.4); }
.btn-g { color: var(--t1); background: rgba(255,255,255,.045); border-color: var(--ln2); }
.btn-g:hover { background: rgba(255,255,255,.08); }
.btn-d { color: #ffd7db; background: rgba(255,93,108,.12); border-color: rgba(255,93,108,.3); }
.btn-d:hover { background: rgba(255,93,108,.2); }
.btn-s { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 8px; }
.btn-i { width: 34px; padding: 0; }
.btn-s.btn-i { width: 28px; }

/* ── Setup & sign-in ── */
.gate { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.gate-card { position: relative; width: min(420px, 100%); border-radius: 20px; padding: 1px;
  background: linear-gradient(160deg, rgba(255,255,255,.18), rgba(255,255,255,.03) 42%, color-mix(in srgb, var(--fx2) 40%, transparent)); }
.gate-in { border-radius: 19px; padding: 30px 28px 26px; background: radial-gradient(ellipse 70% 60% at 50% -10%, color-mix(in srgb, var(--fx2) 18%, transparent), transparent 70%), rgba(8,13,22,.92);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
.gate h1 { margin: 18px 0 6px; font-size: 20px; letter-spacing: -.02em; font-weight: 650; }
.gate p { margin: 0 0 18px; color: var(--t2); font-size: 13px; }
.gate .brand { display: flex; align-items: center; gap: 10px; }
.tagc { font-size: 11px; color: var(--t2); padding: 3px 8px; border-radius: 99px; border: 1px solid var(--ln2); background: rgba(255,255,255,.04); }
.field { display: grid; gap: 6px; margin-bottom: 12px; }
.field label { font-size: 12px; color: var(--t2); font-weight: 500; }
.inp { width: 100%; height: 38px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--ln2); background: rgba(0,0,0,.28); outline: none; transition: border-color .15s, box-shadow .15s; }
.inp:focus { border-color: color-mix(in srgb, var(--fx2) 70%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--fx2) 18%, transparent); }
textarea.inp { height: auto; padding: 10px 12px; resize: vertical; min-height: 90px; line-height: 1.5; }
select.inp { appearance: none; padding-right: 30px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 9px center; background-size: 14px; }
.gate .btn-p { width: 100%; height: 40px; margin-top: 6px; }
.err { margin: 0 0 12px; padding: 9px 12px; border-radius: 10px; font-size: 12.5px; color: #ffd7db; background: rgba(255,93,108,.1); border: 1px solid rgba(255,93,108,.25); }
.hashbox { margin: 8px 0 14px; padding: 12px; border-radius: 10px; background: rgba(0,0,0,.35); border: 1px dashed rgba(167,243,208,.3); font: 12px/1.5 var(--mono); color: #a7f3d0; word-break: break-all; user-select: all; }
.steps-s { margin: 0 0 14px; padding-left: 18px; color: var(--t2); font-size: 12.5px; }
.steps-s li { margin-bottom: 4px; }
.steps-s code { font-family: var(--mono); font-size: 11.5px; color: #cfe9ff; }

/* ── App shell ── */
.shell { display: grid; grid-template-columns: var(--side) minmax(0, 1fr); min-height: 100vh; }
.side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 4px; padding: 18px 12px 14px; border-right: 1px solid var(--ln);
  background: rgba(5,10,18,.55); backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%); overflow-y: auto; }
.side .brand { display: flex; align-items: center; gap: 9px; padding: 2px 8px 16px; }
.side .brand .tagc { margin-left: auto; }
.nav-g { margin: 12px 0 4px; padding: 0 10px; font-size: 11px; color: var(--t3); font-weight: 500; }
.nav a { position: relative; display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 10px; border-radius: 9px; color: var(--t2); font-size: 13px; font-weight: 500; transition: color .15s, background-color .15s; }
.nav a svg { width: 16px; height: 16px; flex: none; opacity: .85; }
.nav a:hover { color: var(--t1); background: rgba(255,255,255,.04); }
.nav a[aria-current="page"] { color: var(--t1); background: linear-gradient(90deg, rgba(94,234,212,.11), rgba(56,189,248,.05)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
.nav a[aria-current="page"]::before { content: ''; position: absolute; left: -12px; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: linear-gradient(#5eead4, #818cf8); }
.nav a .cnt { margin-left: auto; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 99px; font: 600 10.5px/18px var(--font); text-align: center; background: rgba(255,255,255,.07); color: var(--t2); }
.nav a .cnt:empty { display: none; }
.nav a .cnt.hot { background: rgba(255,93,108,.18); color: #ffb4bc; }
.side-foot { margin-top: auto; display: grid; gap: 8px; padding-top: 14px; }
.ai-sw { display: flex; align-items: center; gap: 10px; padding: 10px 11px; border-radius: 11px; border: 1px solid var(--ln); background: rgba(255,255,255,.025); }
.ai-sw b { display: block; font-size: 12.5px; font-weight: 600; }
.ai-sw span { font-size: 11.5px; color: var(--t3); }
.me { display: flex; align-items: center; gap: 9px; padding: 4px 6px; font-size: 12px; color: var(--t2); }
.me .av { width: 26px; height: 26px; }
.me a { margin-left: auto; color: var(--t3); font-size: 12px; }
.me a:hover { color: var(--t1); }

.main { min-width: 0; display: flex; flex-direction: column; }
.top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 14px; padding: 16px 28px 14px; border-bottom: 1px solid var(--ln);
  background: rgba(3,10,16,.66); backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%); }
.top h1 { margin: 0; font-size: 19px; line-height: 1.2; letter-spacing: -.025em; font-weight: 650;
  background: linear-gradient(180deg, #fff 30%, #aab4c8); -webkit-background-clip: text; background-clip: text; color: transparent; }
.top .sub { font-size: 12px; color: var(--t3); margin-top: 1px; }
.top .tools { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.menu-btn { display: none; }
.search { position: relative; }
.search .inp { width: 240px; height: 34px; padding-left: 32px; background: rgba(255,255,255,.035); }
.search > svg { position: absolute; left: 10px; top: 10px; width: 14px; height: 14px; color: var(--t3); pointer-events: none; }
.search kbd { position: absolute; right: 8px; top: 8px; font: 500 10.5px/18px var(--mono); color: var(--t3); padding: 0 5px; border-radius: 5px; border: 1px solid var(--ln2); }
.sres { position: absolute; right: 0; top: 40px; width: 340px; max-height: 420px; overflow: auto; border-radius: 12px; border: 1px solid var(--ln2); background: rgba(10,16,26,.97);
  box-shadow: 0 24px 60px -20px rgba(0,0,0,.9); padding: 6px; display: none; }
.sres.on { display: block; }
.sres a { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; }
.sres a:hover, .sres a.sel { background: rgba(255,255,255,.06); }
.sres .none { padding: 12px; color: var(--t3); font-size: 12.5px; }
.live { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 11px; border-radius: 10px; border: 1px solid var(--ln2); background: rgba(255,255,255,.035); font-size: 12px; color: var(--t2); cursor: pointer; }
.live i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); animation: pulse 2.4s ease-in-out infinite; }
.live.off i { background: var(--t3); animation: none; }
.live.busy i { background: var(--info); }
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(48,209,88,.4); } 50% { box-shadow: 0 0 0 5px rgba(48,209,88,0); } }
.seg { display: inline-flex; padding: 3px; border-radius: 10px; border: 1px solid var(--ln); background: rgba(255,255,255,.03); }
.seg button { height: 26px; padding: 0 10px; border: 0; border-radius: 7px; background: none; color: var(--t2); font-size: 12px; font-weight: 500; cursor: pointer; }
.seg button:hover { color: var(--t1); }
.seg button[aria-pressed="true"] { color: var(--t1); background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }

.page { padding: 22px 28px 60px; display: grid; gap: 16px; align-content: start; }
.banner { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; font-size: 13px; border: 1px solid rgba(245,165,36,.3); background: rgba(245,165,36,.08); color: #fde4b3; }
.banner.bad { border-color: rgba(255,93,108,.32); background: rgba(255,93,108,.09); color: #ffd1d6; }
.banner.info { border-color: rgba(125,211,252,.25); background: rgba(56,189,248,.07); color: #d3eefc; }
.banner svg { width: 17px; height: 17px; flex: none; }
.banner .btn { margin-left: auto; }

/* Cards and grids */
.grid { display: grid; gap: 16px; }
.g2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.g3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.g4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.g6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.g21 { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
.g12 { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); }
.card { position: relative; border-radius: var(--r); border: 1px solid var(--ln); background: var(--glass); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); min-width: 0; }
.card-h { display: flex; align-items: center; gap: 10px; padding: 14px 16px 0; }
.card-h h2 { margin: 0; font-size: 13.5px; font-weight: 600; letter-spacing: -.01em; }
.card-h .hint { font-size: 12px; color: var(--t3); }
.card-h .right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.card-b { padding: 14px 16px 16px; }
.card-b.flush { padding: 10px 0 4px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11.5px; color: var(--t2); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 8px; height: 8px; border-radius: 3px; }

/* KPI tiles: the one place with the landing page's pointer light. */
.kpi { padding: 14px 16px 12px; overflow: hidden;
  background: radial-gradient(300px circle at var(--mx, -40%) var(--my, -40%), rgba(125,211,252,.07), transparent 45%), var(--glass); }
.kpi .l { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--t2); font-weight: 500; }
.kpi .l svg { width: 14px; height: 14px; color: var(--t3); }
.kpi .v { margin-top: 6px; font-size: 25px; font-weight: 650; letter-spacing: -.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi .v small { font-size: 13px; color: var(--t3); font-weight: 500; letter-spacing: 0; margin-left: 4px; }
.kpi .s { margin-top: 5px; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--t3); min-height: 18px; }
.kpi .sp { display: block; width: 100%; height: 26px; margin-top: 8px; opacity: .9; }
.kpi.hero .v { font-size: 30px; background: linear-gradient(90deg, #5eead4, #7dd3fc 50%, #a5b4fc); -webkit-background-clip: text; background-clip: text; color: transparent; }
.kpi[data-go] { cursor: pointer; }
.kpi[data-go]:hover { border-color: var(--ln2); }
.delta { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.delta.up { color: #86efac; background: rgba(48,209,88,.1); }
.delta.down { color: #fda4af; background: rgba(255,93,108,.1); }
.delta.flat { color: var(--t2); background: rgba(255,255,255,.05); }

/* Charts */
.chart { position: relative; height: 220px; margin: 4px 0 0; }
.chart.sm { height: 150px; }
.chart.xs { height: 110px; }
.chart svg.plot { position: absolute; left: 44px; right: 8px; top: 8px; bottom: 22px; width: calc(100% - 52px); height: calc(100% - 30px); overflow: visible; }
.chart .yt { position: absolute; left: 0; width: 38px; text-align: right; font: 10.5px/1 var(--mono); color: var(--t3); transform: translateY(-50%); }
.chart .xt { position: absolute; bottom: 0; font: 10.5px/1 var(--mono); color: var(--t3); transform: translateX(-50%); white-space: nowrap; }
.chart .gl { position: absolute; left: 44px; right: 8px; height: 1px; background: rgba(255,255,255,.045); }
.chart .cross { position: absolute; top: 8px; bottom: 22px; width: 1px; background: rgba(255,255,255,.18); pointer-events: none; display: none; }
.tip { position: fixed; z-index: 80; pointer-events: none; min-width: 150px; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--ln2); background: rgba(8,13,22,.96);
  box-shadow: 0 16px 40px -14px rgba(0,0,0,.9); font-size: 12px; display: none; }
.tip .th { color: var(--t2); font-size: 11px; margin-bottom: 5px; }
.tip .tr { display: flex; align-items: center; gap: 7px; }
.tip .tr i { width: 8px; height: 8px; border-radius: 3px; }
.tip .tr b { margin-left: auto; padding-left: 14px; font-variant-numeric: tabular-nums; font-weight: 600; }
.empty-chart { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12.5px; color: var(--t3); }
.donut { display: flex; align-items: center; gap: 18px; }
.donut svg { width: 128px; height: 128px; flex: none; }
.donut .dl { display: grid; gap: 7px; font-size: 12.5px; flex: 1; min-width: 0; }
.donut .dl div { display: flex; align-items: center; gap: 8px; }
.donut .dl i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.donut .dl b { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.bars { display: grid; gap: 9px; }
.bar-r { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; font-size: 12.5px; }
.bar-r .bt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--t1); }
.bar-r .bv { font-variant-numeric: tabular-nums; color: var(--t2); }
.bar-r .bb { grid-column: 1 / -1; height: 6px; border-radius: 99px; background: rgba(255,255,255,.05); overflow: hidden; }
.bar-r .bb i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #5eead4, #38bdf8 60%, #818cf8); }
.heat { display: grid; grid-template-columns: 34px repeat(24, minmax(0, 1fr)); gap: 3px; font: 10px/1 var(--mono); color: var(--t3); }
.heat div { aspect-ratio: 1; border-radius: 3px; background: rgba(255,255,255,.035); }
.heat .hl { aspect-ratio: auto; background: none; display: flex; align-items: center; }
.heat .hh { aspect-ratio: auto; background: none; text-align: center; }

/* Tables */
.tw { overflow-x: auto; }
table.t { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.t th { position: sticky; top: 0; text-align: left; font-weight: 500; font-size: 11.5px; color: var(--t3); padding: 8px 12px; border-bottom: 1px solid var(--ln); white-space: nowrap; background: rgba(9,14,24,.6); }
.t th.r, .t td.r { text-align: right; }
.t th[data-sort] { cursor: pointer; user-select: none; }
.t th[data-sort]:hover { color: var(--t1); }
.t th.sorted { color: var(--t1); }
.t th.sorted::after { content: ' ↓'; }
.t th.sorted.asc::after { content: ' ↑'; }
.t td { padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
.t tbody tr { transition: background-color .12s; }
.t tbody tr:hover { background: rgba(255,255,255,.025); }
.t tbody tr[data-acc], .t tbody tr[data-open] { cursor: pointer; }
.t td.num { font-variant-numeric: tabular-nums; }
.t .dim { color: var(--t3); }
.t .clip { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.who > div { min-width: 0; }
.who b { display: block; font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.who > div > span { display: block; font-size: 11.5px; color: var(--t3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.av { position: relative; width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 11px; font-weight: 600; color: #e6f6ff;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.av.on::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 2px #0a121c; }
.pager { display: flex; align-items: center; gap: 8px; padding: 12px 16px; font-size: 12px; color: var(--t3); }
.pager .btn { margin-left: 4px; }
.pager .sp { margin-left: auto; }

/* Chips and badges */
.chip { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 99px; font-size: 11px; font-weight: 600; white-space: nowrap;
  background: rgba(255,255,255,.055); color: var(--t2); border: 1px solid rgba(255,255,255,.06); }
.chip i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.ok { color: #86efac; background: rgba(48,209,88,.09); border-color: rgba(48,209,88,.2); }
.chip.warn { color: #fcd38d; background: rgba(245,165,36,.09); border-color: rgba(245,165,36,.22); }
.chip.bad { color: #ffb4bc; background: rgba(255,93,108,.1); border-color: rgba(255,93,108,.24); }
.chip.info { color: #bae6fd; background: rgba(56,189,248,.09); border-color: rgba(56,189,248,.2); }
.chip.guest { color: #c7d2fe; background: rgba(129,140,248,.11); border-color: rgba(129,140,248,.24); }
.chip.tg { color: #bae6fd; } .chip.dc { color: #c7d2fe; } .chip.dm { color: #99f6e4; }
.risk { display: inline-flex; align-items: center; gap: 7px; }
.risk .rb { width: 42px; height: 5px; border-radius: 99px; background: rgba(255,255,255,.07); overflow: hidden; }
.risk .rb i { display: block; height: 100%; border-radius: 99px; }
.risk b { font-variant-numeric: tabular-nums; font-size: 12px; min-width: 18px; }
.tabs { display: flex; gap: 2px; padding: 3px; border-radius: 11px; border: 1px solid var(--ln); background: rgba(255,255,255,.025); overflow-x: auto; }
.tabs button { height: 30px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--t2); font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 7px; }
.tabs button:hover { color: var(--t1); }
.tabs button[aria-selected="true"] { color: var(--t1); background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
.tabs .cnt { font-size: 10.5px; color: var(--t3); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.toolbar .inp { width: 280px; height: 34px; }
.toolbar .grow { flex: 1; }

/* Feed */
.feed { display: grid; max-height: 640px; overflow-y: auto; }
.ev { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 9px 16px; border-top: 1px solid rgba(255,255,255,.035); font-size: 12.5px; }
.ev:first-child { border-top: 0; }
.ev[data-acc] { cursor: pointer; }
.ev[data-acc]:hover { background: rgba(255,255,255,.02); }
.ev .ei { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; }
.ev .ei svg { width: 13px; height: 13px; }
.ev .et { color: var(--t1); line-height: 1.45; padding-top: 3px; overflow-wrap: anywhere; }
.ev time { color: var(--t3); font-size: 11px; padding-top: 5px; white-space: nowrap; }
.ico-signup { color: #99f6e4; background: rgba(20,184,166,.13); }
.ico-guest { color: #c7d2fe; background: rgba(129,140,248,.13); }
.ico-sale { color: #86efac; background: rgba(48,209,88,.12); }
.ico-tx { color: var(--t2); background: rgba(255,255,255,.06); }
.ico-error { color: #ffb4bc; background: rgba(255,93,108,.12); }
.ico-spam { color: #fcd38d; background: rgba(245,165,36,.12); }
.ico-bot { color: #fcd38d; background: rgba(245,165,36,.1); }
.ico-admin { color: #bae6fd; background: rgba(56,189,248,.1); }

.rank { display: grid; }
.rank a { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 16px; font-size: 12.5px; }
.rank a:hover { background: rgba(255,255,255,.025); }
.rank .n { color: var(--t3); font: 11px var(--mono); }
.rank b { font-variant-numeric: tabular-nums; font-weight: 600; }
.empty { padding: 26px 16px; text-align: center; color: var(--t3); font-size: 12.5px; }
.empty b { display: block; color: var(--t2); font-weight: 600; margin-bottom: 3px; font-size: 13px; }
.kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px 16px; font-size: 12.5px; }
.kv dt { color: var(--t3); }
.kv dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.meter { height: 8px; border-radius: 99px; background: rgba(255,255,255,.06); overflow: hidden; display: flex; }
.meter i { height: 100%; }

/* Drawer (account detail) and modals */
.scrim { position: fixed; inset: 0; z-index: 50; background: rgba(1,5,9,.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .2s; }
.scrim.on { opacity: 1; pointer-events: auto; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 60; width: min(980px, 100vw); display: flex; flex-direction: column;
  background: linear-gradient(180deg, rgba(8,15,25,.98), rgba(5,11,19,.98)); border-left: 1px solid var(--ln2); box-shadow: -40px 0 80px -30px rgba(0,0,0,.8);
  transform: translateX(100%); transition: transform .28s cubic-bezier(.16,1,.3,1); }
.drawer.on { transform: none; }
.dr-h { display: flex; align-items: center; gap: 14px; padding: 18px 22px 14px; border-bottom: 1px solid var(--ln); }
.dr-h .av { width: 46px; height: 46px; font-size: 15px; }
.dr-h h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; font-weight: 650; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dr-h .meta { font-size: 12px; color: var(--t3); margin-top: 2px; }
.dr-h .x { margin-left: auto; align-self: flex-start; }
.dr-act { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 22px; border-bottom: 1px solid var(--ln); }
.dr-tabs { padding: 12px 22px 0; }
.dr-b { flex: 1; overflow-y: auto; padding: 16px 22px 40px; display: grid; gap: 14px; align-content: start; }
.modal-w { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px; background: rgba(1,5,9,.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.modal { width: min(460px, 100%); max-height: calc(100vh - 40px); overflow: auto; border-radius: 16px; border: 1px solid var(--ln2); background: rgba(9,15,25,.98); box-shadow: 0 40px 90px -30px rgba(0,0,0,.95); animation: pop .22s cubic-bezier(.16,1,.3,1); }
.modal.wide { width: min(820px, 100%); }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
.modal-h { padding: 18px 20px 4px; }
.modal-h h3 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.015em; }
.modal-b { padding: 8px 20px 4px; color: var(--t2); font-size: 13px; }
.modal-b p { margin: 0 0 12px; }
.modal-f { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px 18px; }
.chat { display: grid; gap: 6px; padding: 12px 20px 18px; max-height: 62vh; overflow-y: auto; }
.bub { max-width: 78%; padding: 8px 11px; border-radius: 13px; font-size: 12.8px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.bub.in { justify-self: start; background: rgba(255,255,255,.07); border-bottom-left-radius: 4px; }
.bub.out { justify-self: end; background: linear-gradient(135deg, rgba(20,184,166,.24), rgba(59,130,246,.22)); border: 1px solid rgba(125,211,252,.14); border-bottom-right-radius: 4px; }
.bub.bot { justify-self: center; background: rgba(255,255,255,.03); border: 1px dashed var(--ln2); color: var(--t2); font-size: 12px; }
.bub small { display: block; font-size: 10.5px; color: rgba(210,230,255,.5); margin-bottom: 2px; }
.bub.failed { border-color: rgba(255,93,108,.4); }
.bub.deleted { opacity: .5; text-decoration: line-through; }
.toasts { position: fixed; right: 20px; bottom: 20px; z-index: 100; display: grid; gap: 8px; }
.toast { display: flex; align-items: center; gap: 10px; min-width: 240px; max-width: 380px; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--ln2); background: rgba(10,16,26,.97);
  box-shadow: 0 20px 50px -20px rgba(0,0,0,.9); font-size: 13px; animation: pop .25s cubic-bezier(.16,1,.3,1); }
.toast i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
.toast.bad i { background: var(--bad); }
.skel { border-radius: 10px; background: linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.07), rgba(255,255,255,.03)); background-size: 200% 100%; animation: sk 1.3s linear infinite; }
@keyframes sk { to { background-position: -200% 0; } }
.reasons { display: flex; flex-wrap: wrap; gap: 5px; }
.pre { margin: 0; padding: 12px; border-radius: 10px; background: rgba(0,0,0,.35); border: 1px solid var(--ln); font: 11.5px/1.55 var(--mono); color: var(--t2); white-space: pre-wrap; max-height: 280px; overflow: auto; }
.price-t .inp { height: 30px; font-size: 12.5px; padding: 0 8px; }
.price-t td { padding: 5px 8px; }
.sw { position: relative; width: 36px; height: 20px; flex: none; border-radius: 99px; border: 0; cursor: pointer; background: rgba(255,255,255,.12); transition: background-color .2s; }
.sw::after { content: ''; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s cubic-bezier(.16,1,.3,1); box-shadow: 0 1px 3px rgba(0,0,0,.4); }
.sw[aria-checked="true"] { background: linear-gradient(135deg, #2dd4bf, #38bdf8); }
.sw[aria-checked="true"]::after { transform: translateX(16px); }
.sw.danger[aria-checked="true"] { background: linear-gradient(135deg, #fb7185, #f43f5e); }
.row-f { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--ln); }
.row-f:first-child { border-top: 0; }
.row-f .tx b { display: block; font-size: 13px; font-weight: 600; }
.row-f .tx span { font-size: 12px; color: var(--t3); }
.row-f > :last-child:not(:first-child) { margin-left: auto; }

/* ── Compact, quieter layout ───────────────────────────────────
   Same information, less chrome: calmer background, tighter spacing,
   stat tiles joined into one strip, smaller charts, flat buttons, and
   long lists split into pages (see paginate() in the script). */
[hidden] { display: none !important; }
:root { --r: 10px; --glass: rgba(11,17,27,.74); }
body { font-size: 13px; }
.fx i { opacity: .16; }
.fx::after { background: radial-gradient(ellipse 110% 90% at 50% 40%, transparent 30%, rgba(0,0,0,.65) 100%); }
.word { animation: none; background-position: 0 50%; }
.top { padding: 11px 24px 10px; }
.top h1 { font-size: 17px; background: none; -webkit-background-clip: border-box; background-clip: border-box; color: var(--t1); }
.top .sub { font-size: 11.5px; }
.page { padding: 16px 24px 48px; gap: 12px; }
.grid { gap: 12px; }
.card { background: var(--glass); backdrop-filter: none; -webkit-backdrop-filter: none; }
.card-h { padding: 11px 14px 0; min-height: 30px; }
.card-h h2 { font-size: 12.5px; font-weight: 600; }
.card-h .hint { font-size: 11.5px; }
.card-b { padding: 10px 14px 12px; }
.card-b.flush { padding: 6px 0 0; }
.banner { padding: 8px 12px; font-size: 12.5px; border-radius: 9px; }
.banner svg { width: 15px; height: 15px; }
.btn { height: 30px; padding: 0 11px; border-radius: 8px; font-size: 12px; }
.btn-s { height: 26px; padding: 0 9px; font-size: 11.5px; border-radius: 7px; }
.btn-i { width: 30px; } .btn-s.btn-i { width: 26px; }
.btn-p { color: #03161a; background: #2dd4bf; box-shadow: none; }
.btn-p:hover { background: #5eead4; box-shadow: none; }
.inp { height: 32px; border-radius: 8px; }
.toolbar .inp { height: 30px; width: 240px; }
.seg button { height: 24px; font-size: 11.5px; }
.tabs { padding: 2px; border-radius: 9px; }
.tabs button { height: 26px; padding: 0 10px; font-size: 12px; }
.live { height: 30px; } .search .inp { height: 30px; } .search > svg { top: 8px; } .search kbd { top: 6px; }

/* Stat tiles in a row become one strip with thin dividers. */
.grid:has(> .kpi) { gap: 0; border: 1px solid var(--ln); border-radius: var(--r); overflow: hidden; background: var(--glass); }
.grid:has(> .kpi) > .kpi { border: 0; border-radius: 0; box-shadow: -1px -1px 0 0 var(--ln); }
.kpi { padding: 10px 14px 9px; background: transparent; }
.kpi .l { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--t3); font-weight: 600; }
.kpi .l svg { width: 12px; height: 12px; }
.kpi .v { margin-top: 4px; font-size: 19px; font-weight: 600; letter-spacing: -.02em; }
.kpi.hero .v { font-size: 19px; background: none; -webkit-background-clip: border-box; background-clip: border-box; color: var(--t1); }
.kpi .v small { font-size: 12px; }
.kpi .s { margin-top: 3px; font-size: 11px; min-height: 16px; }
.kpi .sp { height: 18px; margin-top: 5px; opacity: .75; }
.kpi[data-go]:hover { background: rgba(255,255,255,.025); }

.chart { height: 180px; } .chart.sm { height: 120px; } .chart.xs { height: 86px; } .chart.lg { height: 326px; }
.donut svg { width: 104px; height: 104px; }

/* Tables: denser rows, quieter headers. */
table.t { font-size: 12.5px; }
.t th { padding: 6px 12px; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; background: rgba(9,14,24,.5); }
.t td { padding: 6px 12px; }
.t td .chip { vertical-align: middle; }
.who { gap: 8px; }
.av { width: 26px; height: 26px; font-size: 10px; }
.who b { font-size: 12.5px; } .who > div > span { font-size: 11px; }
.chip { height: 18px; padding: 0 7px; font-size: 10.5px; }
.chip.ai { color: #f0c6ff; background: rgba(233,168,255,.08); border-color: rgba(233,168,255,.18); }
.pager { padding: 7px 14px; font-size: 11.5px; border-top: 1px solid rgba(255,255,255,.04); }
.pager.pg { gap: 6px; }
.pager .btn { margin-left: 0; }
.pager .pgn { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; color: var(--t2); }

/* Feed and rankings */
.feed { max-height: none; overflow: visible; }
.ev { grid-template-columns: 22px minmax(0, 1fr) auto; gap: 9px; padding: 6px 14px; align-items: center; }
.ev .ei { width: 22px; height: 22px; border-radius: 6px; }
.ev .ei svg { width: 11px; height: 11px; }
.ev .et { padding-top: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev time { padding-top: 0; }
.rank a { padding: 6px 14px; }
.bars { gap: 7px; } .bar-r { font-size: 12px; } .bar-r .bb { height: 4px; }
.kv { gap: 6px 14px; font-size: 12.5px; }
.row-f { padding: 10px 0; }

/* Latest messages: one line per conversation */
.mconv td { white-space: nowrap; }
.mconv .mc { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.mconv .mc b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.mconv .mt { color: var(--t2); }
.pi { flex: none; } .pi-tg { color: var(--c-tg); } .pi-dc { color: var(--c-dc); } .pi-dm { color: var(--c-dm); }
.newdot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); flex: none; box-shadow: 0 0 0 3px rgba(48,209,88,.14); }

.t .who > div { display: flex; align-items: baseline; gap: 6px; }
.t .who .av { width: 22px; height: 22px; font-size: 9px; }
.t .who b { max-width: 170px; }
.t .who > div > span { max-width: 120px; }
.rank .rk { display: flex; align-items: center; gap: 7px; min-width: 0; }
.clip1 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Drawer */
.dr-h { padding: 14px 20px 12px; }
.dr-h .av { width: 38px; height: 38px; font-size: 13px; }
.dr-h h2 { font-size: 16px; }
.dr-act { padding: 9px 20px; }
.dr-tabs { padding: 10px 20px 0; }
.dr-b { padding: 12px 20px 32px; gap: 12px; }

@media (max-width: 1280px) { .g6 { grid-template-columns: repeat(3, minmax(0, 1fr)); } .g4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 1080px) { .g21, .g12, .g3 { grid-template-columns: minmax(0, 1fr); } .search .inp { width: 180px; } }
@media (max-width: 860px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side { position: fixed; left: 0; top: 0; bottom: 0; z-index: 70; width: 260px; transform: translateX(-100%); transition: transform .25s cubic-bezier(.16,1,.3,1); background: rgba(5,10,18,.97); }
  .side.on { transform: none; }
  .menu-btn { display: inline-flex; }
  .top { padding: 12px 16px; flex-wrap: wrap; }
  .top .tools { width: 100%; margin-left: 0; flex-wrap: wrap; }
  .search { flex: 1; } .search .inp { width: 100%; }
  .page { padding: 16px 14px 60px; }
  .g2, .g6 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dr-h, .dr-act, .dr-tabs, .dr-b { padding-left: 14px; padding-right: 14px; }
}
@media (max-width: 520px) { .g2, .g4, .g6 { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 520px) { .grid:has(> .kpi) { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpi .sp { display: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<div class="fx" aria-hidden="true"><i></i><i></i><i></i></div>
<?php $h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); ?>
<?php if ($A_VIEW === 'setup'): ?>
<main class="gate">
  <div class="gate-card"><div class="gate-in">
    <div class="brand"><span class="word">booqi</span><span class="tagc">Console</span></div>
    <?php if ($A_SETUP_HASH === ''): ?>
      <h1>Choose an admin password</h1>
      <p>The console isn’t protected yet. Pick a password and you’ll get a line to paste into admin.php. Nothing is saved until you do.</p>
      <?php if ($A_LOGIN_ERR): ?><div class="err"><?= $h($A_LOGIN_ERR) ?></div><?php endif; ?>
      <form method="post" autocomplete="off">
        <div class="field"><label for="p1">Password (12 characters or more)</label><input class="inp" id="p1" name="setup_pw" type="password" minlength="12" required autofocus></div>
        <div class="field"><label for="p2">Password again</label><input class="inp" id="p2" name="setup_pw2" type="password" minlength="12" required></div>
        <button class="btn btn-p" type="submit">Create the hash</button>
      </form>
    <?php else: ?>
      <h1>Paste this into admin.php</h1>
      <ol class="steps-s">
        <li>Open <code>admin.php</code> and find <code>const ADMIN_PASSWORD_HASH = '';</code></li>
        <li>Put the line below between the quotes and save.</li>
        <li>Upload the file again, then reload this page to sign in as <code><?= $h(ADMIN_USERNAME) ?></code>.</li>
      </ol>
      <div class="hashbox"><?= $h($A_SETUP_HASH) ?></div>
      <p>This page can’t read your password back, so keep it somewhere safe.</p>
    <?php endif; ?>
  </div></div>
</main>
<?php elseif ($A_VIEW === 'login'): ?>
<main class="gate">
  <div class="gate-card"><div class="gate-in">
    <div class="brand"><span class="word">booqi</span><span class="tagc">Console</span></div>
    <h1>Sign in to the console</h1>
    <p>Everything across every account, live.</p>
    <?php if ($A_LOGIN_ERR): ?><div class="err"><?= $h($A_LOGIN_ERR) ?></div><?php endif; ?>
    <form method="post" autocomplete="off">
      <input type="hidden" name="csrf" value="<?= $h(a_csrf()) ?>">
      <div class="field"><label for="u">Username</label><input class="inp" id="u" name="login_user" required autofocus autocomplete="username"></div>
      <div class="field"><label for="p">Password</label><input class="inp" id="p" name="login_pass" type="password" required autocomplete="current-password"></div>
      <button class="btn btn-p" type="submit">Sign in</button>
    </form>
  </div></div>
</main>
<?php else: ?>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></symbol>
  <symbol id="i-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .6 3.5 2.6 3.5 6"/></symbol>
  <symbol id="i-ghost" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a7 7 0 0 0-7 7v10.5l2.33-1.75L9.67 20.5 12 18.75l2.33 1.75 2.34-1.75L19 20.5V10a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".9" fill="currentColor"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M12 8v5M12 16h.01"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-coin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.4-1-1.6-1.7-3-1.7-1.8 0-3 .9-3 2.1 0 2.9 6 1.4 6 4.3 0 1.2-1.3 2.1-3 2.1-1.5 0-2.7-.7-3.1-1.8M12 6v1.8M12 16.2V18"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.3A8.4 8.4 0 1 1 21 11.5z"/></symbol>
  <symbol id="i-server" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></symbol>
  <symbol id="i-list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></symbol>
  <symbol id="i-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
  <symbol id="i-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M4 20h16"/></symbol>
  <symbol id="i-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></symbol>
  <symbol id="i-bolt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></symbol>
  <symbol id="i-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
  <symbol id="i-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></symbol>
  <symbol id="i-key" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/></symbol>
  <symbol id="i-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></symbol>
  <symbol id="i-tg" viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.4l-3.1 14.7c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3c.8-.3 1.6.2 1.3 1.4z"/></symbol>
  <symbol id="i-dc" viewBox="0 0 24 24" fill="currentColor"><path d="M19.3 5.3A16.5 16.5 0 0 0 15.2 4l-.5 1a15.3 15.3 0 0 0-5.4 0L8.8 4a16.4 16.4 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.6 16.6 0 0 0 5 2.5l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.8 11.8 0 0 0 11 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.5 16.5 0 0 0 5-2.5c.4-4.3-.7-8.1-3-11.4zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></symbol>
</defs></svg>

<div class="shell">
  <aside class="side" id="side">
    <div class="brand"><span class="word">booqi</span><span class="tagc">Console</span></div>
    <nav class="nav" aria-label="Console">
      <div class="nav-g">Monitor</div>
      <a href="#/overview" data-v="overview"><svg><use href="#i-home"/></svg>Overview</a>
      <a href="#/messages" data-v="messages"><svg><use href="#i-chat"/></svg>Messages</a>
      <div class="nav-g">People</div>
      <a href="#/accounts" data-v="accounts"><svg><use href="#i-users"/></svg>Accounts<span class="cnt" id="n-acc"></span></a>
      <a href="#/guests" data-v="guests"><svg><use href="#i-ghost"/></svg>Temporary accounts<span class="cnt" id="n-guest"></span></a>
      <a href="#/risk" data-v="risk"><svg><use href="#i-shield"/></svg>Spam &amp; risk<span class="cnt" id="n-risk"></span></a>
      <div class="nav-g">Money</div>
      <a href="#/revenue" data-v="revenue"><svg><use href="#i-coin"/></svg>Revenue</a>
      <a href="#/ai" data-v="ai"><svg><use href="#i-spark"/></svg>AI usage &amp; cost</a>
      <div class="nav-g">Platform</div>
      <a href="#/system" data-v="system"><svg><use href="#i-server"/></svg>System health</a>
      <a href="#/audit" data-v="audit"><svg><use href="#i-list"/></svg>Audit log</a>
      <a href="#/settings" data-v="settings"><svg><use href="#i-gear"/></svg>Settings</a>
    </nav>
    <div class="side-foot">
      <div class="ai-sw">
        <div><b id="ai-state">AI is running</b><span id="ai-sub">Agents reply as normal</span></div>
        <button class="sw danger" id="ai-pause" role="switch" aria-checked="false" aria-label="Pause all AI" style="margin-left:auto"></button>
      </div>
      <div class="me"><span class="av" style="background:linear-gradient(145deg,#0d2a33,#0b1a31)"><svg width="14" height="14"><use href="#i-user"/></svg></span><?= $h(ADMIN_USERNAME) ?><a href="?logout=1">Sign out</a></div>
    </div>
  </aside>
  <div class="main">
    <header class="top">
      <button class="btn btn-g btn-i menu-btn" id="menu" aria-label="Menu"><svg><use href="#i-menu"/></svg></button>
      <div><h1 id="title">Overview</h1><div class="sub" id="subtitle"></div></div>
      <div class="tools">
        <div id="range-slot"></div>
        <div class="search">
          <svg><use href="#i-search"/></svg>
          <input class="inp" id="gsearch" placeholder="Find an account" autocomplete="off" aria-label="Find an account">
          <kbd>/</kbd>
          <div class="sres" id="sres"></div>
        </div>
        <button class="live" id="live" title="Pause or resume live updates"><i></i><span>Live</span></button>
      </div>
    </header>
    <div class="page" id="page"></div>
  </div>
</div>
<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-label="Account" aria-hidden="true"></aside>
<div class="tip" id="tip"></div>
<div class="toasts" id="toasts" aria-live="polite"></div>
<script>
window.BQ = { csrf: <?= json_encode(a_csrf()) ?>, refresh: <?= (int)a_setting('refresh_sec', 15) ?>, app: <?= json_encode(ADMIN_APP_URL) ?> };
</script>
<script>
(function () {
'use strict';
// ── Basics ──────────────────────────────────────────────────
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = {
  view: 'overview', data: null, live: true, busy: false, lastAt: 0, skew: 0, refresh: Math.max(5, BQ.refresh || 15),
  ranges: { ai: '30d', revenue: '30d', messages: '7d' },
  acc: { type: 'accounts', sort: 'created', dir: 'desc', page: 1, q: '' },
  guests: { filter: 'all', q: '' }, msg: { q: '', role: '', page: 1 },
  drawer: null, dtab: 'overview', charts: {}, chartN: 0, boot: null, modal: false, reqId: 0, pg: {},
};
const VIEWS = {
  overview: ['Overview', 'Everything happening on booqi, updated live'],
  accounts: ['Accounts', 'Every account, what it does and what it costs'],
  guests: ['Temporary accounts', 'Guests who started a chat from someone’s contact link'],
  risk: ['Spam & risk', 'Signals that an account is being used for spam or abuse'],
  revenue: ['Revenue', 'What sellers have sold through booqi'],
  ai: ['AI usage & cost', 'Every AI call, priced with your list in Settings'],
  messages: ['Messages', 'Volume on every channel, and the latest messages'],
  system: ['System health', 'Bots, background queues, database and server'],
  audit: ['Audit log', 'Everything done from this console'],
  settings: ['Settings', 'Built-in AI, prices, currencies, your take rate and live updates'],
};
const RANGED = { ai: 1, revenue: 1, messages: 1 };

// ── Server calls ────────────────────────────────────────────
function parseT(t) { if (!t) return NaN; return Date.parse(String(t).replace(' ', 'T') + (String(t).length <= 10 ? 'T00:00:00Z' : 'Z')); }
async function handle(r) {
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('The server sent an unreadable answer (' + r.status + ').'); }
  if (r.status === 401) { setTimeout(() => location.reload(), 800); throw new Error(j.error || 'Signed out.'); }
  if (!r.ok || j.error) throw new Error(j.error || ('Error ' + r.status));
  if (j._now) S.skew = Date.now() - parseT(j._now);
  if (j._warn && j._warn.length) console.warn('[console] server notes:', j._warn);
  return j;
}
async function api(name, params) {
  const u = new URLSearchParams(Object.assign({ api: name }, params || {}));
  return handle(await fetch('?' + u.toString(), { credentials: 'same-origin', headers: { Accept: 'application/json' } }));
}
async function post(name, body) {
  return handle(await fetch('?api=' + encodeURIComponent(name), {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF': BQ.csrf }, body: JSON.stringify(body || {}),
  }));
}

// ── Formatting ──────────────────────────────────────────────
const nf = new Intl.NumberFormat('en-US');
const n = (x) => nf.format(Math.round(+x || 0));
function compact(x) {
  x = +x || 0; const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (x / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return n(x);
}
function usd(x, exact) {
  x = +x || 0; const a = Math.abs(x);
  if (a === 0) return '$0';
  if (a >= 10000 && !exact) return '$' + compact(x);
  if (a >= 1) return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 0.1) return '$' + x.toFixed(2);
  if (a >= 0.01) return '$' + x.toFixed(3);
  return '$' + x.toPrecision(2);
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '%';
function ago(t) {
  const ms = parseT(t); if (isNaN(ms)) return '—';
  const s = Math.max(0, Math.round((Date.now() - S.skew - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
  return day(t);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function day(t) { const m = String(t || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + (m[1] !== String(new Date().getFullYear()) ? ', ' + m[1] : '') : '—'; }
function when(t) { const m = String(t || '').match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[4] + ':' + m[5] : (t ? day(t) : '—'); }
function xlab(l) { if (/^\d{4}-\d\d-\d\d \d\d:00$/.test(l)) return l.slice(11); if (/^\d\d:\d\d$/.test(l)) return l; return day(l).replace(/, \d{4}$/, ''); }
function dur(s) { s = Math.max(0, +s || 0); if (s < 60) return s + 's'; if (s < 3600) return Math.round(s / 60) + ' min'; return (s / 3600).toFixed(1).replace(/\.0$/, '') + ' h'; }
function bytes(b) { b = +b || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (i ? b.toFixed(b >= 100 ? 0 : 1) : b) + ' ' + u[i]; }
const plural = (k, one, many) => n(k) + ' ' + (Math.round(k) === 1 ? one : (many || one + 's'));

// ── Small building blocks ───────────────────────────────────
const GRADS = [['#14b8a6', '#0e7490'], ['#0ea5e9', '#1e40af'], ['#6366f1', '#312e81'], ['#8b5cf6', '#4c1d95'], ['#06b6d4', '#155e75'], ['#10b981', '#065f46'], ['#3b82f6', '#1e3a8a'], ['#a855f7', '#581c87']];
function initials(name) { const p = String(name || '?').replace(/^@/, '').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ''))).toUpperCase(); }
function av(a, cls) {
  if (!a) return '<span class="av" style="background:#1b2536">?</span>';
  const g = GRADS[(+a.id || 0) % GRADS.length];
  const on = a.seen && (Date.now() - S.skew - parseT(a.seen)) < 300000;
  return '<span class="av' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" style="background:linear-gradient(145deg,' + g[0] + ',' + g[1] + ')">' + esc(initials(a.name || a.username)) + '</span>';
}
function who(a, sub) {
  if (!a) return '<span class="dim">—</span>';
  const line = sub != null ? sub : ('@' + (a.username || '') + (a.email ? ' · ' + a.email : ''));
  return '<div class="who">' + av(a) + '<div><b>' + esc(a.name || a.username || ('#' + a.id)) + '</b><span>' + esc(line) + '</span></div></div>';
}
function whoLink(a, sub) { return a && a.id ? '<a href="#/account/' + a.id + '" class="who-l">' + who(a, sub) + '</a>' : who(a, sub); }
function chips(a) {
  let s = '';
  if (!a) return s;
  if (a.suspended) s += '<span class="chip bad"><i></i>Suspended</span> ';
  if (a.guest) s += '<span class="chip guest">Guest</span> ';
  if (a.claimed) s += '<span class="chip ok">Claimed</span> ';
  if (a.online) s += '<span class="chip ok"><i></i>Online</span> ';
  return s;
}
const RISK_C = { high: '#ff5d6c', medium: '#f5a524', low: '#7dd3fc', none: '#3d4658' };
const lvl = (s) => (s >= 60 ? 'high' : s >= 30 ? 'medium' : s > 0 ? 'low' : 'none');
function riskBar(s) {
  if (!s) return '<span class="dim">—</span>';
  const c = RISK_C[lvl(s)];
  return '<span class="risk"><span class="rb"><i style="width:' + Math.min(100, s) + '%;background:' + c + '"></i></span><b style="color:' + c + '">' + s + '</b></span>';
}
function platIco(p) {
  p = String(p || '').toLowerCase();
  const k = p === 'discord' ? 'dc' : p === 'direct' ? 'dm' : 'tg';
  return '<svg class="pi pi-' + k + '" width="13" height="13" aria-label="' + esc(p || 'telegram') + '"><use href="#i-' + (k === 'dm' ? 'lock' : k) + '"/></svg>';
}
function plat(p) {
  p = String(p || '').toLowerCase();
  if (p === 'discord') return '<span class="chip dc"><svg width="11" height="11"><use href="#i-dc"/></svg>Discord</span>';
  if (p === 'direct') return '<span class="chip dm"><svg width="11" height="11"><use href="#i-lock"/></svg>Direct</span>';
  return '<span class="chip tg"><svg width="11" height="11"><use href="#i-tg"/></svg>Telegram</span>';
}
function kpi(o) {
  return '<div class="card kpi' + (o.hero ? ' hero' : '') + '"' + (o.go ? ' data-go="' + esc(o.go) + '"' : '') + '>'
    + '<div class="l">' + (o.icon ? '<svg><use href="#' + o.icon + '"/></svg>' : '') + esc(o.label) + '</div>'
    + '<div class="v">' + o.value + (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') + '</div>'
    + '<div class="s">' + (o.sub || '') + '</div>'
    + (o.spark ? spark(o.spark, o.sparkColor) : '') + '</div>';
}
function delta(cur, prev) {
  if (!prev && !cur) return '<span class="delta flat">no change</span>';
  if (!prev) return '<span class="delta up">new</span>';
  const d = Math.round(((cur - prev) / prev) * 100);
  return '<span class="delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat') + '">' + (d > 0 ? '+' : '') + d + '%</span>';
}
function card(title, body, o) {
  o = o || {};
  return '<section class="card' + (o.cls ? ' ' + o.cls : '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + '>'
    + (title ? '<div class="card-h"><h2>' + esc(title) + '</h2>' + (o.hint ? '<span class="hint">' + esc(o.hint) + '</span>' : '') + (o.right ? '<div class="right">' + o.right + '</div>' : '') + '</div>' : '')
    + '<div class="card-b' + (o.flush ? ' flush' : '') + '">' + body + '</div></section>';
}
const empty = (title, text) => '<div class="empty"><b>' + esc(title) + '</b>' + esc(text || '') + '</div>';
function legend(items) { return '<div class="legend">' + items.map((i) => '<span><i style="background:' + i[1] + '"></i>' + esc(i[0]) + '</span>').join('') + '</div>'; }
function seg(name, cur, opts) {
  return '<div class="seg" role="group">' + opts.map((o) => '<button data-seg="' + name + '" data-val="' + o[0] + '" aria-pressed="' + (o[0] === cur ? 'true' : 'false') + '">' + esc(o[1]) + '</button>').join('') + '</div>';
}
function tabs(name, cur, opts) {
  return '<div class="tabs" role="tablist">' + opts.map((o) => '<button role="tab" data-tab="' + name + '" data-val="' + o[0] + '" aria-selected="' + (o[0] === cur ? 'true' : 'false') + '">' + esc(o[1]) + (o[2] != null ? ' <span class="cnt">' + esc(o[2]) + '</span>' : '') + '</button>').join('') + '</div>';
}
function bars(list, fmt, color) {
  if (!list.length) return empty('Nothing yet');
  const max = Math.max.apply(null, list.map((x) => x[1])) || 1;
  return '<div class="bars">' + list.map((x) => '<div class="bar-r"' + (x[2] ? ' ' + x[2] : '') + '><span class="bt">' + x[0] + '</span><span class="bv">' + (fmt ? fmt(x[1]) : n(x[1])) + '</span>'
    + '<span class="bb"><i style="width:' + Math.max(2, (x[1] / max) * 100) + '%' + (color ? ';background:' + color : '') + '"></i></span></div>').join('') + '</div>';
}

// ── Charts (SVG, responsive, with a hover readout) ──────────
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
// A top for four gridlines that land on round numbers.
function niceTop(v) {
  if (v <= 0) return 4;
  const step = v / 4, p = Math.pow(10, Math.floor(Math.log10(step))), f = step / p;
  const m = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10].find((x) => f <= x + 1e-9);
  return m * p * 4;
}
function chart(cfg) {
  const id = 'c' + (++S.chartN);
  S.charts[id] = cfg;
  const L = cfg.labels || [], N = L.length;
  const fmt = cfg.fmt || compact;
  const bars = cfg.series.filter((s) => s.type === 'bar');
  const lines = cfg.series.filter((s) => s.type !== 'bar');
  let max = 0;
  for (let i = 0; i < N; i++) {
    let st = 0;
    bars.forEach((s) => { st += +s.values[i] || 0; });
    max = Math.max(max, cfg.stacked ? st : Math.max.apply(null, bars.map((s) => +s.values[i] || 0).concat([0])));
    lines.forEach((s) => { if (!s.axis2) max = Math.max(max, +s.values[i] || 0); });
  }
  const top = niceTop(max * 1.05);
  let max2 = 0; lines.forEach((s) => { if (s.axis2) s.values.forEach((v) => { max2 = Math.max(max2, +v || 0); }); });
  const top2 = niceTop(max2 * 1.05);
  const X = (i) => (bars.length ? ((i + 0.5) / N) * 1000 : (N > 1 ? (i / (N - 1)) * 1000 : 500));
  const Y = (v, s) => 100 - (Math.max(0, +v || 0) / (s && s.axis2 ? top2 : top)) * 100;
  let svg = '<svg class="plot" viewBox="0 0 1000 100" preserveAspectRatio="none"><defs>';
  lines.forEach((s, k) => { if (s.fill !== false) svg += '<linearGradient id="' + id + 'g' + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".32"/><stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient>'; });
  svg += '</defs>';
  if (bars.length) {
    const bw = Math.max(1.5, (1000 / N) * (N > 60 ? 0.8 : 0.62));
    for (let i = 0; i < N; i++) {
      let base = 100;
      bars.forEach((s, k) => {
        const v = +s.values[i] || 0; if (!v) return;
        const h = (v / top) * 100;
        const x = X(i) - (cfg.stacked ? bw / 2 : (bw / 2) - (bw / bars.length) * k);
        const w = cfg.stacked ? bw : bw / bars.length;
        const y = cfg.stacked ? base - h : 100 - h;
        svg += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(3) + '" width="' + w.toFixed(2) + '" height="' + h.toFixed(3) + '" fill="' + s.color + '" opacity="' + (s.opacity || 0.85) + '" rx="0"/>';
        if (cfg.stacked) base -= h;
      });
    }
  }
  lines.forEach((s, k) => {
    if (!N) return;
    let d = '';
    for (let i = 0; i < N; i++) d += (i ? 'L' : 'M') + X(i).toFixed(2) + ',' + Y(s.values[i], s).toFixed(3);
    if (s.fill !== false) svg += '<path d="' + d + 'L' + X(N - 1).toFixed(2) + ',100L' + X(0).toFixed(2) + ',100Z" fill="url(#' + id + 'g' + k + ')"/>';
    svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="4 4"' : '') + '/>';
  });
  svg += '</svg>';
  let html = '<div class="chart ' + (cfg.size || '') + '" data-chart="' + id + '">';
  for (let t = 0; t <= 4; t++) {
    const f = t / 4, v = top * (1 - f);
    const pos = 'calc(8px + (100% - 30px) * ' + f + ')';
    html += '<div class="gl" style="top:' + pos + '"></div><div class="yt" style="top:' + pos + '">' + esc(fmt(v)) + '</div>';
  }
  const want = Math.min(N, cfg.xticks || ({ sm: 5, xs: 4 }[cfg.size] || 7));
  for (let t = 0; t < want; t++) {
    const i = want === 1 ? 0 : Math.round((t / (want - 1)) * (N - 1));
    html += '<div class="xt" style="left:calc(44px + (100% - 52px) * ' + (X(i) / 1000) + ')">' + esc((cfg.xfmt || xlab)(L[i])) + '</div>';
  }
  html += svg + '<div class="cross"></div>';
  const total = cfg.series.reduce((a, s) => a + s.values.reduce((b, v) => b + (+v || 0), 0), 0);
  if (!total && cfg.emptyText) html += '<div class="empty-chart">' + esc(cfg.emptyText) + '</div>';
  return html + '</div>';
}
function spark(vals, color) {
  vals = (vals || []).map((v) => +v || 0);
  if (vals.length < 2) return '';
  const max = Math.max.apply(null, vals) || 1;
  let d = '';
  vals.forEach((v, i) => { d += (i ? 'L' : 'M') + ((i / (vals.length - 1)) * 100).toFixed(2) + ',' + (28 - (v / max) * 26).toFixed(2); });
  const c = color || '#5eead4';
  return '<svg class="sp" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="' + d + 'L100,30L0,30Z" fill="' + c + '" opacity=".12"/><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
}
function donut(items, fmt) {
  const tot = items.reduce((a, x) => a + x[1], 0);
  if (!tot) return empty('Nothing yet');
  let off = 0, arcs = '';
  const R = 15.915;
  items.forEach((x) => {
    const p = (x[1] / tot) * 100;
    arcs += '<circle cx="21" cy="21" r="' + R + '" fill="none" stroke="' + x[2] + '" stroke-width="5" stroke-dasharray="' + Math.max(0, p - 0.6).toFixed(3) + ' ' + (100 - Math.max(0, p - 0.6)).toFixed(3) + '" stroke-dashoffset="' + (25 - off).toFixed(3) + '"/>';
    off += p;
  });
  return '<div class="donut"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="' + R + '" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="5"/>' + arcs
    + '<text x="21" y="22.5" text-anchor="middle" fill="#eef0f6" font-size="5.2" font-weight="600" font-family="Inter">' + esc((fmt || compact)(tot)) + '</text></svg>'
    + '<div class="dl">' + items.map((x) => '<div><i style="background:' + x[2] + '"></i>' + esc(x[0]) + '<b>' + esc((fmt || compact)(x[1])) + ' <span class="dim" style="font-weight:400">' + pct(x[1], tot) + '</span></b></div>').join('') + '</div></div>';
}
function heatmap(h) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let max = 0; h.forEach((r) => r.forEach((v) => { max = Math.max(max, v); }));
  let s = '<div class="heat"><div class="hh"></div>';
  for (let i = 0; i < 24; i++) s += '<div class="hh">' + (i % 3 === 0 ? String(i).padStart(2, '0') : '') + '</div>';
  h.forEach((r, d) => {
    s += '<div class="hl">' + days[d] + '</div>';
    r.forEach((v, i) => { const a = max ? v / max : 0; s += '<div title="' + days[d] + ' ' + String(i).padStart(2, '0') + ':00 · ' + n(v) + ' messages" style="background:' + (v ? 'rgba(56,189,248,' + (0.08 + a * 0.85).toFixed(3) + ')' : '') + '"></div>'; });
  });
  return s + '</div>';
}
// Hover readout for every chart on the page.
document.addEventListener('pointermove', (e) => {
  const tip = $('#tip');
  const el = e.target.closest && e.target.closest('.chart');
  $$('.chart .cross').forEach((c) => { if (!el || !el.contains(c)) c.style.display = 'none'; });
  if (!el) { tip.style.display = 'none'; return; }
  const cfg = S.charts[el.dataset.chart]; const plot = $('svg.plot', el);
  if (!cfg || !plot) return;
  const r = plot.getBoundingClientRect();
  const N = cfg.labels.length; if (!N) return;
  const f = (e.clientX - r.left) / r.width;
  if (f < -0.02 || f > 1.02) { tip.style.display = 'none'; return; }
  const hasBars = cfg.series.some((s) => s.type === 'bar');
  const i = Math.max(0, Math.min(N - 1, hasBars ? Math.floor(f * N) : Math.round(f * (N - 1))));
  const x = hasBars ? ((i + 0.5) / N) : (N > 1 ? i / (N - 1) : 0.5);
  const cross = $('.cross', el);
  cross.style.display = 'block';
  cross.style.left = (plot.getBoundingClientRect().left - el.getBoundingClientRect().left + x * r.width) + 'px';
  const fmt = cfg.tipFmt || cfg.fmt || n;
  let html = '<div class="th">' + esc(cfg.tipLabel ? cfg.tipLabel(cfg.labels[i]) : (/^\d{4}-\d\d-\d\d$/.test(cfg.labels[i]) ? day(cfg.labels[i]) : cfg.labels[i])) + '</div>';
  cfg.series.forEach((s) => { html += '<div class="tr"><i style="background:' + s.color + '"></i>' + esc(s.name) + '<b>' + esc((s.fmt || fmt)(+s.values[i] || 0)) + '</b></div>'; });
  if (cfg.stacked && cfg.series.filter((s) => s.type === 'bar').length > 1) {
    const t = cfg.series.filter((s) => s.type === 'bar').reduce((a, s) => a + (+s.values[i] || 0), 0);
    html += '<div class="tr" style="margin-top:4px;color:var(--t2)"><i style="background:transparent"></i>Total<b>' + esc(fmt(t)) + '</b></div>';
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.min(e.clientX + 16, innerWidth - tw - 10) + 'px';
  tip.style.top = Math.max(10, Math.min(e.clientY - th - 12, innerHeight - th - 10)) + 'px';
});
// The landing page's pointer light, on the stat tiles only.
document.addEventListener('pointermove', (e) => {
  const k = e.target.closest && e.target.closest('.kpi');
  if (!k) return;
  const r = k.getBoundingClientRect();
  k.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  k.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

// ── Toasts & modals ─────────────────────────────────────────
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.innerHTML = '<i></i><span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, bad ? 6000 : 3200);
}
// ask({title, body, input:{label,type,placeholder,value,match}, ok, danger, wide, html}) → value | true | null
function ask(o) {
  return new Promise((resolve) => {
    S.modal = true;
    const w = document.createElement('div');
    w.className = 'modal-w';
    const inp = o.input ? '<div class="field" style="margin-top:4px"><label for="mi">' + esc(o.input.label || '') + '</label>'
      + (o.input.type === 'textarea' ? '<textarea class="inp" id="mi" placeholder="' + esc(o.input.placeholder || '') + '">' + esc(o.input.value || '') + '</textarea>'
        : '<input class="inp" id="mi" type="' + esc(o.input.type || 'text') + '" placeholder="' + esc(o.input.placeholder || '') + '" value="' + esc(o.input.value || '') + '" autocomplete="off">') + '</div>' : '';
    w.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true"><div class="modal-h"><h3>' + esc(o.title) + '</h3></div>'
      + '<div class="modal-b">' + (o.html || (o.body ? '<p>' + esc(o.body) + '</p>' : '')) + inp + '</div>'
      + '<div class="modal-f"><button class="btn btn-g" data-m="no">' + esc(o.cancel || 'Cancel') + '</button>' + (o.ok === false ? '' : '<button class="btn ' + (o.danger ? 'btn-d' : 'btn-p') + '" data-m="ok">' + esc(o.ok || 'Confirm') + '</button>') + '</div>'
      + '</div>';
    document.body.appendChild(w);
    const mi = $('#mi', w), okb = $('[data-m="ok"]', w);
    const check = () => { if (okb && o.input && o.input.match != null) okb.disabled = mi.value.trim() !== o.input.match; };
    if (mi) { mi.addEventListener('input', check); check(); setTimeout(() => mi.focus(), 30); } else if (okb) setTimeout(() => okb.focus(), 30);
    const done = (v) => { S.modal = false; document.removeEventListener('keydown', key, true); w.remove(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } if (e.key === 'Enter' && mi && mi.tagName === 'INPUT' && okb && !okb.disabled) { e.preventDefault(); done(mi.value); } };
    document.addEventListener('keydown', key, true);
    w.addEventListener('click', (e) => {
      if (e.target === w) return done(null);
      const b = e.target.closest('[data-m]');
      if (b) done(b.dataset.m === 'ok' ? (mi ? mi.value : true) : null);
    });
    if (o.onOpen) o.onOpen(w, done);
  });
}

// ══ VIEWS ═══════════════════════════════════════════════════
const C = { tg: '#38bdf8', dc: '#818cf8', dm: '#5eead4', ai: '#e9a8ff', money: '#86efac', warn: '#f5a524', bad: '#ff5d6c', gem: '#7aa2ff', oai: '#d6dbe4', cla: '#e2906f' };
const PROV = { gemini: ['Gemini', C.gem], openai: ['OpenAI', C.oai], claude: ['Claude', C.cla] };
// Whose AI costs are counted (Settings → AI page switch): your built-in AI by default.
const SCOPE = { builtin: ['Built-in AI', 'on your built-in AI'], own: ['Customers’ own keys', 'on customers’ own keys'], all: ['Both', 'on your built-in AI and customers’ own keys'] };
const scopeOf = (s) => SCOPE[s] || SCOPE.builtin;
const provName = (p) => p === 'builtin' ? 'Built-in AI' : (PROV[p] || [p])[0];
const EV_ICON = { signup: 'i-user', guest: 'i-ghost', sale: 'i-coin', tx: 'i-coin', error: 'i-alert', spam: 'i-shield', bot: 'i-bot', admin: 'i-key' };

const V = {};

V.overview = function (d) {
  const k = d.kpi, s = d.series;
  let h = '';
  if (k.llm_paused) h += '<div class="banner bad"><svg><use href="#i-pause"/></svg><span><b>All AI calls are paused.</b> Agents on every account are silent until you resume them.</span><button class="btn btn-g btn-s" data-act="resume-ai">Resume AI</button></div>';
  if (S.boot && !S.boot.api_patched) h += '<div class="banner"><svg><use href="#i-alert"/></svg><span>The api.php on the server is the old one, so AI calls aren’t being recorded and suspensions don’t take effect. Upload the new api.php.</span></div>';
  const msgs = s.telegram.map((v, i) => v + s.discord[i] + s.direct[i]);
  h += '<div class="grid g6">'
    + kpi({ label: 'Online now', icon: 'i-eye', value: n(k.online), hero: true, sub: n(k.dau) + ' today · ' + n(k.wau) + ' this week', go: 'accounts?type=online' })
    + kpi({ label: 'Accounts', icon: 'i-users', value: n(k.accounts), sub: delta(k.signups_7d, k.signups_prev7) + ' ' + plural(k.signups_7d, 'sign-up') + ' this week', spark: s.signups, go: 'accounts' })
    + kpi({ label: 'Temporary accounts', icon: 'i-ghost', value: n(k.guests), sub: n(k.guests_today) + ' today · ' + pct(k.claimed, k.guests) + ' claimed', spark: s.guests, sparkColor: C.dc, go: 'guests' })
    + kpi({ label: 'Messages today', icon: 'i-chat', value: n(k.msg_today), sub: n(k.ai_today) + ' written by agents', spark: msgs, sparkColor: C.tg, go: 'messages' })
    + kpi({ label: k.ai_scope === 'builtin' ? 'Built-in AI cost today' : 'AI cost today', icon: 'i-spark', value: usd(k.llm_today.cost),
        sub: usd(k.llm_30d.cost) + ' in 30 days · ' + (k.ai_scope === 'builtin' ? (k.builtin.on ? plural(k.builtin.users, 'account') + ' on it' : 'built-in AI is off') : esc(scopeOf(k.ai_scope)[1])), spark: s.cost, sparkColor: C.ai, go: 'ai' })
    + kpi({ label: 'Sales, 30 days', icon: 'i-coin', value: usd(k.sales_30d.usd), sub: k.take_rate > 0 ? 'You earn ' + usd(k.earn_30d) + ' at ' + k.take_rate + '%' : plural(k.sales_30d.n, 'order') + ' · ' + usd(k.sales_today.usd) + ' today', spark: s.sales, sparkColor: C.money, go: 'revenue' })
    + '</div>';
  h += '<div class="grid g21">'
    + card('Activity, last 30 days', chart({ labels: s.labels, stacked: true, series: [
        { name: 'Telegram', color: C.tg, values: s.telegram, type: 'bar' }, { name: 'Discord', color: C.dc, values: s.discord, type: 'bar' },
        { name: 'Direct', color: C.dm, values: s.direct, type: 'bar' }, { name: 'By agents', color: C.ai, values: s.ai, fill: false, dash: true }], emptyText: 'No messages in the last 30 days' }),
      { right: legend([['Telegram', C.tg], ['Discord', C.dc], ['Direct', C.dm], ['By agents', C.ai]]) })
    + card('The last hour', chart({ labels: d.pulse.labels, size: 'sm', xticks: 5, series: [
        { name: 'Messages', color: C.tg, values: d.pulse.messages }, { name: 'AI calls', color: C.ai, values: d.pulse.llm, fill: false },
        { name: 'Failed AI calls', color: C.bad, values: d.pulse.errors, fill: false }], emptyText: 'Quiet for the last hour' })
      + '<dl class="kv" style="margin-top:14px"><dt>Messages</dt><dd class="num">' + n(d.pulse.messages.reduce((a, b) => a + b, 0)) + '</dd>'
      + '<dt>AI calls</dt><dd class="num">' + n(d.pulse.llm.reduce((a, b) => a + b, 0)) + '</dd><dt>Failed AI calls</dt><dd class="num">' + n(d.pulse.errors.reduce((a, b) => a + b, 0)) + '</dd></dl>',
      { hint: 'minute by minute' })
    + '</div>';
  h += '<div class="grid g3">'
    + card('Sign-ups', chart({ labels: s.labels, size: 'sm', series: [{ name: 'Accounts', color: C.dm, values: s.signups, type: 'bar' }, { name: 'Guests', color: C.dc, values: s.guests, type: 'bar' }], emptyText: 'No sign-ups yet' }), { right: legend([['Accounts', C.dm], ['Guests', C.dc]]) })
    + card(k.ai_scope === 'builtin' ? 'Built-in AI cost per day' : 'AI cost per day', chart({ labels: s.labels, size: 'sm', fmt: usd, series: [{ name: 'Cost', color: C.ai, values: s.cost }], emptyText: k.ai_scope === 'builtin' ? 'No calls on the built-in AI yet' : 'No AI calls recorded yet' }), { hint: usd(s.cost.reduce((a, b) => a + b, 0)) + ' in 30 days' })
    + card('Sales per day', chart({ labels: s.labels, size: 'sm', fmt: usd, series: [{ name: 'Sales', color: C.money, values: s.sales, type: 'bar' }], emptyText: 'No sales yet' }), { hint: usd(k.sales_30d.usd) + ' in 30 days' })
    + '</div>';
  const feed = d.feed.length ? '<div class="feed">' + d.feed.map((e) => '<div class="ev"' + (e.acc ? ' data-acc="' + e.acc + '"' : '') + '><span class="ei ico-' + e.kind + '"><svg><use href="#' + (EV_ICON[e.kind] || 'i-bolt') + '"/></svg></span><span class="et">' + esc(e.text) + '</span><time>' + esc(ago(e.t)) + '</time></div>').join('') + '</div>' : empty('Nothing has happened yet');
  const top = (list, fmt) => list.length ? '<div class="rank">' + list.map((x, i) => '<a href="#/account/' + x.acc.id + '"><span class="n">' + (i + 1) + '</span>' + who(x.acc, x.acc.guest ? 'Guest' : '@' + x.acc.username) + '<b>' + fmt(x.v) + '</b></a>').join('') + '</div>' : empty('Nobody yet');
  const tt = S.topTab || 'messages';
  h += '<div class="grid g21" style="align-items:start">'
    + card('What’s happening', feed, { flush: true, hint: 'newest first' })
    + card('Top accounts', top(d.top[tt], tt === 'messages' ? n : usd), { flush: true, right: seg('top', tt, [['messages', 'Messages'], ['cost', k.ai_scope === 'builtin' ? 'Built-in AI' : 'AI cost'], ['sales', 'Sales']]) })
    + '</div><div class="grid g2">'
    + card('Safety', '<dl class="kv">'
        + '<dt>High-risk accounts</dt><dd><a href="#/risk" class="chip ' + (k.risk_high ? 'bad' : '') + '">' + n(k.risk_high) + '</a></dd>'
        + '<dt>Medium-risk accounts</dt><dd><a href="#/risk" class="chip ' + (k.risk_med ? 'warn' : '') + '">' + n(k.risk_med) + '</a></dd>'
        + '<dt>Spam cooldowns running</dt><dd class="num">' + n(k.cooldowns) + '</dd>'
        + '<dt>Suspended accounts</dt><dd><a href="#/accounts?type=suspended" class="num">' + n(k.suspended) + '</a></dd>'
        + '<dt>AI calls failing (30d)</dt><dd class="num">' + pct(k.llm_30d.errors, k.llm_30d.calls) + '</dd></dl>')
    + card('Engagement', '<dl class="kv"><dt>Active today</dt><dd class="num">' + n(k.dau) + '</dd><dt>Active this week</dt><dd class="num">' + n(k.wau) + '</dd><dt>Active this month</dt><dd class="num">' + n(k.mau) + '</dd>'
        + '<dt>Daily / monthly</dt><dd class="num">' + pct(k.dau, k.mau) + '</dd><dt>Sign-ups today</dt><dd class="num">' + n(k.signups_today) + '</dd></dl>')
    + '</div>';
  return h;
};

V.accounts = function (d) {
  const a = S.acc, c = d.counts;
  const col = (key, label, r) => '<th data-sort="' + key + '" class="' + (r ? 'r ' : '') + (a.sort === key ? 'sorted' + (a.dir === 'asc' ? ' asc' : '') : '') + '">' + label + '</th>';
  let h = '<div class="toolbar">' + tabs('acctype', a.type, [['accounts', 'Accounts', c.accounts], ['guests', 'Temporary', c.guests], ['online', 'Online', c.online], ['new', 'New this week', c.new], ['flagged', 'Flagged', c.flagged], ['suspended', 'Suspended', c.suspended], ['all', 'Everyone', c.all]])
    + '<span class="grow"></span><input class="inp" id="acc-q" placeholder="Name, username, email or #id" value="' + esc(a.q) + '">'
    + '<a class="btn btn-g" href="?api=export&what=accounts"><svg><use href="#i-down"/></svg>Export CSV</a></div>';
  if (!d.rows.length) return h + card('', empty('No accounts match', a.q ? 'Try a different search.' : 'Nothing in this list right now.'));
  h += '<section class="card"><div class="tw"><table class="t" data-nopage><thead><tr>' + col('name', 'Account') + '<th>Status</th>' + col('created', 'Joined') + col('seen', 'Last seen')
    + col('msgs', 'Msgs 30d', 1) + col('ai', 'By agents', 1) + col('cost', d.ai_scope === 'builtin' ? 'Built-in AI' : 'AI cost', 1) + col('sales', 'Sales', 1) + col('convs', 'Chats', 1) + '<th class="r">Bots</th>' + col('risk', 'Risk') + '</tr></thead><tbody>';
  d.rows.forEach((r) => {
    h += '<tr data-acc="' + r.id + '"><td>' + who(r, r.guest ? 'Guest of ' + (r.guest_of ? r.guest_of.name : '—') : null) + '</td><td>' + (chips(r) || '<span class="dim">Active</span>') + '</td>'
      + '<td class="dim">' + esc(day(r.created)) + '</td><td class="dim">' + esc(r.seen ? ago(r.seen) : 'never') + '</td>'
      + '<td class="r num">' + n(r.msgs) + '</td><td class="r num">' + n(r.ai) + '</td><td class="r num">' + (r.calls ? usd(r.cost) : '<span class="dim">—</span>') + '</td>'
      + '<td class="r num">' + (r.orders ? usd(r.sales) : '<span class="dim">—</span>') + '</td><td class="r num">' + n(r.convs) + '</td><td class="r num">' + (r.bots || '<span class="dim">—</span>') + '</td>'
      + '<td title="' + esc(r.risk_top) + '">' + riskBar(r.risk) + '</td></tr>';
  });
  h += '</tbody></table></div><div class="pager">' + n(d.total) + ' ' + (d.total === 1 ? 'account' : 'accounts') + '<span class="sp">Page ' + d.page + ' of ' + d.pages + '</span>'
    + '<button class="btn btn-g btn-s" data-page="' + (d.page - 1) + '"' + (d.page <= 1 ? ' disabled' : '') + '>Previous</button><button class="btn btn-g btn-s" data-page="' + (d.page + 1) + '"' + (d.page >= d.pages ? ' disabled' : '') + '>Next</button></div></section>';
  return h;
};

V.guests = function (d) {
  const s = d.stats, g = S.guests;
  let h = '<div class="grid g6">'
    + kpi({ label: 'Temporary accounts', icon: 'i-ghost', value: n(s.total), hero: true, sub: n(s.week) + ' this week' })
    + kpi({ label: 'New today', icon: 'i-user', value: n(s.today), spark: d.series.created, sparkColor: C.dc })
    + kpi({ label: 'Turned into accounts', icon: 'i-check', value: n(s.claimed), sub: pct(s.claimed, s.total) + ' of guests', spark: d.series.claimed, sparkColor: C.dm })
    + kpi({ label: 'Never wrote anything', icon: 'i-eye', value: n(s.silent), sub: 'removed after 3 days' })
    + kpi({ label: 'Active in 24 h', icon: 'i-bolt', value: n(s.active24) })
    + kpi({ label: 'Agent replies to guests', icon: 'i-spark', value: n(s.ai_replies), sub: n(s.messages) + ' messages from guests' })
    + '</div>';
  h += '<div class="grid g21">'
    + card('New guests and claims, 30 days', chart({ labels: d.series.labels, size: 'sm', series: [{ name: 'New guests', color: C.dc, values: d.series.created, type: 'bar' }, { name: 'Claimed', color: C.dm, values: d.series.claimed, fill: false }], emptyText: 'No guests yet' }), { right: legend([['New guests', C.dc], ['Claimed', C.dm]]) })
    + card('Who guests are writing to', bars(d.hosts.map((x) => [esc(x.name), x.n, 'data-acc="' + x.id + '" style="cursor:pointer"'])), { hint: 'top hosts' })
    + '</div>';
  h += card('Clean up', '<div class="row-f"><div class="tx"><b>Remove silent guests</b><span>Guests who never sent or received a message. Nothing is lost.</span></div>'
      + '<div style="display:flex;gap:8px;align-items:center"><span class="dim">older than</span><input class="inp" id="pg-days" type="number" min="0" max="365" value="3" style="width:70px;height:30px"><span class="dim">days</span><button class="btn btn-g btn-s" data-act="purge" data-mode="silent">Remove</button></div></div>'
      + '<div class="row-f"><div class="tx"><b>Remove unclaimed guests</b><span>Also removes their conversations from the people they wrote to.</span></div>'
      + '<div style="display:flex;gap:8px;align-items:center"><span class="dim">older than</span><input class="inp" id="pg-days2" type="number" min="1" max="365" value="30" style="width:70px;height:30px"><span class="dim">days</span><button class="btn btn-d btn-s" data-act="purge" data-mode="unclaimed">Remove</button></div></div>'
      + '<div class="row-f"><div class="tx"><b>Limits for each guest</b><span>' + d.limits.msg_min + ' messages a minute, ' + d.limits.msg_hour + ' an hour, ' + d.limits.msg_day + ' a day · ' + d.limits.ai_hour + ' agent replies an hour, ' + d.limits.ai_day + ' a day. Set in api.php.</span></div></div>');
  h += '<div class="toolbar">' + tabs('gfilter', g.filter, [['all', 'All'], ['active', 'Active in 24 h'], ['silent', 'Silent'], ['claimed', 'Claimed'], ['flagged', 'Flagged']])
    + '<span class="grow"></span><input class="inp" id="guest-q" placeholder="Search guest or host" value="' + esc(g.q) + '"></div>';
  if (!d.rows.length) return h + card('', empty('No guests match'));
  h += '<section class="card"><div class="tw"><table class="t" data-per="25"><thead><tr><th>Guest</th><th>Writing to</th><th>Started</th><th>Last seen</th><th class="r">Sent</th><th class="r">Received</th><th class="r">From agents</th><th class="r">Same address</th><th>Risk</th><th></th></tr></thead><tbody>';
  d.rows.forEach((r) => {
    h += '<tr data-acc="' + r.id + '"><td>' + who(r, '@' + r.username) + '</td><td><a href="#/account/' + r.host.id + '" data-stop>' + esc(r.host.name) + '</a></td><td class="dim">' + esc(ago(r.created)) + '</td>'
      + '<td class="dim">' + esc(r.seen ? ago(r.seen) : 'never') + '</td><td class="r num">' + n(r.sent) + '</td><td class="r num">' + n(r.recv) + '</td><td class="r num">' + n(r.ai) + '</td>'
      + '<td class="r num">' + (r.cluster > 1 ? '<span class="chip ' + (r.cluster >= 8 ? 'bad' : r.cluster >= 3 ? 'warn' : '') + '">' + n(r.cluster) + '</span>' : '<span class="dim">—</span>') + '</td>'
      + '<td title="' + esc(r.risk_top) + '">' + riskBar(r.risk) + '</td><td class="r">' + (r.claimed ? '<span class="chip ok">Claimed</span> ' : '') + (r.suspended ? '<span class="chip bad">Suspended</span> ' : '')
      + '<button class="btn btn-g btn-s btn-i" title="Delete guest" data-act="del-guest" data-id="' + r.id + '" data-u="' + esc(r.username) + '"><svg><use href="#i-trash"/></svg></button></td></tr>';
  });
  h += '</tbody></table></div>' + (d.shown > 400 ? '<div class="pager">Only the newest 400 of ' + n(d.shown) + ' are listed. Search to narrow it down.</div>' : '') + '</section>';
  return h;
};

V.risk = function (d) {
  const l = d.levels;
  let h = '<div class="grid g6">'
    + kpi({ label: 'High risk', icon: 'i-shield', value: n(l.high), hero: true, sub: 'score 60 or more' })
    + kpi({ label: 'Medium risk', icon: 'i-shield', value: n(l.medium), sub: 'score 30–59' })
    + kpi({ label: 'Low risk', icon: 'i-shield', value: n(l.low), sub: 'one small signal' })
    + kpi({ label: 'Spam cooldowns now', icon: 'i-pause', value: n(d.cooldowns.length), sub: 'agents holding replies' })
    + kpi({ label: 'Near a limit', icon: 'i-bolt', value: n(d.pressure.length), sub: 'message or AI budgets' })
    + kpi({ label: 'Shared addresses', icon: 'i-users', value: n(d.clusters.length), sub: '3+ accounts from one place' })
    + '</div>';
  const flagged = d.rows.filter((r) => r.score > 0);
  h += card('Flagged accounts', flagged.length ? '<div class="tw"><table class="t" data-per="15"><thead><tr><th>Account</th><th>Score</th><th>Why</th><th>Joined</th><th></th></tr></thead><tbody>'
      + flagged.map((r) => '<tr data-acc="' + r.acc.id + '"><td>' + who(r.acc, r.acc.guest ? 'Guest' : null) + '</td><td>' + riskBar(r.score) + '</td><td><div class="reasons">'
        + r.reasons.map((x) => '<span class="chip ' + (x.pts >= 25 ? 'bad' : x.pts >= 15 ? 'warn' : 'info') + '" title="+' + x.pts + ' points">' + esc(x.why) + '</span>').join('') + '</div></td>'
        + '<td class="dim">' + esc(ago(r.acc.created)) + '</td><td class="r">' + (r.acc.suspended ? '<span class="chip bad">Suspended</span>' : '<button class="btn btn-d btn-s" data-act="suspend" data-id="' + r.acc.id + '" data-name="' + esc(r.acc.name) + '">Suspend</button>') + '</td></tr>').join('')
      + '</tbody></table></div>' : empty('Nothing flagged', 'No account shows any of the signals below.'), { flush: true, hint: n(flagged.length) + ' accounts' });
  h += '<div class="grid g2">'
    + card('Spam cooldowns running now', d.cooldowns.length ? '<div class="tw"><table class="t"><thead><tr><th>Seller</th><th>Sender</th><th>Where</th><th class="r">Hits</th><th>Reason</th><th class="r">Ends in</th></tr></thead><tbody>'
        + d.cooldowns.map((c) => '<tr><td>' + (c.owner ? '<a href="#/account/' + c.owner.id + '">' + esc(c.owner.name) + '</a>' : '—') + '</td><td>' + (c.who && c.who.id ? '<a href="#/account/' + c.who.id + '">' + esc(c.who.name) + '</a>' : esc(c.who ? c.who.name : '—')) + '</td>'
          + '<td>' + esc(c.where) + '</td><td class="r num">' + n(c.hits) + '</td><td class="clip dim" title="' + esc(c.reason || '') + '">' + esc(c.reason || '—') + '</td><td class="r num">' + dur(c.left) + '</td></tr>').join('')
        + '</tbody></table></div>' : empty('No cooldowns running', 'Agents pause replies when a chat looks like spam; none are paused now.'), { flush: true })
    + card('Running close to a limit', d.pressure.length ? '<div class="tw"><table class="t"><thead><tr><th>Account</th><th>Limit</th><th class="r">Used</th></tr></thead><tbody>'
        + d.pressure.map((p) => '<tr data-acc="' + p.acc.id + '"><td>' + esc(p.acc.name) + (p.acc.guest ? ' <span class="chip guest">Guest</span>' : '') + '</td><td class="dim">' + esc(p.what) + '</td><td class="r"><span class="chip ' + (p.pct >= 100 ? 'bad' : p.pct >= 80 ? 'warn' : '') + '">' + n(p.n) + ' / ' + n(p.max) + '</span></td></tr>').join('')
        + '</tbody></table></div>' : empty('Nobody is near a limit'), { flush: true })
    + '</div>';
  h += '<div class="grid g21">'
    + card('Several accounts from one address', d.clusters.length ? '<div class="tw"><table class="t"><thead><tr><th>Address</th><th class="r">Accounts</th><th class="r">Guests</th><th>First → last</th><th>Who</th></tr></thead><tbody>'
        + d.clusters.map((c) => '<tr><td class="mono dim">' + esc(c.tag) + '…</td><td class="r num">' + n(c.n) + '</td><td class="r num">' + n(c.guests) + '</td><td class="dim">' + esc(when(c.first)) + ' → ' + esc(when(c.last)) + '</td>'
          + '<td><div style="display:flex;gap:3px;flex-wrap:wrap">' + c.members.map((m) => '<a href="#/account/' + m.id + '" title="' + esc(m.name) + '">' + av(m) + '</a>').join('') + '</div></td></tr>').join('')
        + '</tbody></table></div><p class="dim" style="font-size:12px;margin:10px 16px 12px">Addresses are stored as keyed hashes, so the console can group them but never shows them.</p>'
      : empty('No shared addresses', 'No three accounts were created from the same place.'), { flush: true })
    + '<div class="grid" style="align-content:start">'
    + card('Why agents flagged spam', bars(Object.entries(d.reasons).slice(0, 8).map((x) => [esc(x[0]), x[1]]), n, 'linear-gradient(90deg,#f5a524,#fb7185)'))
    + card('Customers blocked by sellers', d.blocked.length ? bars(d.blocked.filter((x) => x.acc).map((x) => [esc(x.acc.name), x.n, 'data-acc="' + x.acc.id + '" style="cursor:pointer"'])) : empty('No blocked customers'))
    + card('How scores work', '<dl class="kv"><dt>Same sign-up address as 2+ / 7+ others</dt><dd>15 / 30</dd><dt>Disposable email</dt><dd>25</dd><dt>Random-looking username</dt><dd>10</dd>'
        + '<dt>Blocked by someone</dt><dd>12 each</dd><dt>Flagged as spam by an agent</dt><dd>10 each</dd><dt>Near a message or AI limit</dt><dd>15</dd>'
        + '<dt>40+ messages a week, no replies</dt><dd>15</dd><dt>New account, 150+ AI calls a day</dt><dd>20</dd><dt>40%+ of AI calls failing</dt><dd>10</dd></dl>')
    + '</div></div>';
  return h;
};

V.ai = function (d) {
  const t = d.totals, s = d.series;
  let h = '';
  if (d.paused) h += '<div class="banner bad"><svg><use href="#i-pause"/></svg><span><b>All AI calls are paused.</b></span><button class="btn btn-g btn-s" data-act="resume-ai">Resume AI</button></div>';
  const sc = d.scope || 'builtin', bi = d.builtin || {};
  // One header card: the built-in AI's state, and whose costs this page counts
  // (your built-in AI by default; customers' own keys only when you ask).
  const biPrice = bi.price ? '$' + (+bi.price.in).toFixed(2) + ' in / $' + (+bi.price.out).toFixed(2) + ' out per 1M' + (bi.price.guess ? ' (fallback price)' : '') : '';
  h += card('Built-in AI', '<div class="row-f" style="padding:2px 0 0"><div class="tx"><b>' + (bi.on ? '<span class="chip ok"><i></i>On</span>' : '<span class="chip">Off</span>') + (bi.model ? ' <span class="mono">' + esc(bi.model) + '</span> <span class="dim" style="font-weight:400">' + esc(provName(bi.provider)) + '</span>' : '') + '</b>'
      + '<span>' + (bi.on ? plural(bi.users || 0, 'account') + ' on it · ' : (bi.has_key ? 'Key saved, turned off · ' : 'No key yet · ')) + esc(biPrice)
      + (d.tracking_since ? ' · recording since ' + esc(day(d.tracking_since)) : '') + (t.est ? ' · ' + n(t.est) + ' calls estimated' : '') + '</span></div>'
      + '<a class="btn btn-g btn-s" href="#/settings">' + (bi.has_key ? 'Change' : 'Set it up') + '</a></div>',
    { right: '<span class="dim" style="font-size:11.5px">Costs</span>' + seg('aiscope', sc, [['builtin', 'Built-in AI'], ['own', 'Customers’ keys'], ['all', 'Both']]) });
  if (!d.tracking_since) h += '<div class="banner info"><svg><use href="#i-spark"/></svg><span>No AI calls recorded yet.</span></div>';
  h += '<div class="grid g6">'
    + kpi({ label: sc === 'builtin' ? 'Built-in AI cost' : sc === 'own' ? 'Cost on customers’ keys' : 'AI cost', icon: 'i-spark', value: usd(t.cost), hero: true, sub: usd(t.per_day) + ' a day on average' })
    + kpi({ label: 'At this pace, a month', icon: 'i-coin', value: usd(t.projected_month) })
    + kpi({ label: 'Calls', icon: 'i-bolt', value: compact(t.calls), spark: s.calls, sparkColor: C.ai })
    + kpi({ label: 'Failed', icon: 'i-alert', value: pct(t.errors, t.calls), sub: n(t.errors) + ' calls', spark: s.errors, sparkColor: C.bad })
    + kpi({ label: 'Tokens', icon: 'i-chat', value: compact(t.in + t.out), sub: compact(t.in) + ' in · ' + compact(t.out) + ' out' + (t.cached ? ' · ' + compact(t.cached) + ' cached' : '') })
    + kpi({ label: 'Average wait', icon: 'i-refresh', value: (t.avg_lat / 1000).toFixed(1), unit: 's', sub: 'per call' })
    + '</div>';
  const ps = ['gemini', 'openai', 'claude'];
  h += '<div class="grid g21">'
    + card('Cost by provider', chart({ labels: s.labels, stacked: true, fmt: usd, series: ps.map((p) => ({ name: PROV[p][0], color: PROV[p][1], values: s.cost[p], type: 'bar' })), emptyText: 'No AI calls in this period' }), { right: legend(ps.map((p) => PROV[p])) })
    + card('Share of cost', donut(d.providers.map((p) => [(PROV[p.key] || [p.key])[0], p.cost, (PROV[p.key] || [0, '#888'])[1]]), usd)
      + '<div style="margin-top:16px">' + chart({ labels: s.labels, size: 'xs', series: [{ name: 'Calls', color: C.ai, values: s.calls }, { name: 'Failed', color: C.bad, values: s.errors, fill: false }] }) + '</div>')
    + '</div>';
  h += '<div class="grid g2">'
    + card('By model', d.models.length ? '<div class="tw"><table class="t"><thead><tr><th>Model</th><th class="r">Calls</th><th class="r">Tokens</th><th class="r">Price in / out</th><th class="r">Cost</th></tr></thead><tbody>'
        + d.models.map((m) => '<tr><td><span class="mono">' + esc(m.key) + '</span>' + (m.price && m.price.guess ? ' <span class="chip warn" title="Not in your price list; priced at the provider’s fallback">No price</span>' : '') + '</td><td class="r num">' + n(m.calls) + '</td>'
          + '<td class="r num">' + compact(m.in + m.out) + '</td><td class="r num dim">$' + (+m.price.in).toFixed(2) + ' / $' + (+m.price.out).toFixed(2) + '</td><td class="r num"><b>' + usd(m.cost) + '</b></td></tr>').join('')
        + '</tbody></table></div>' : empty('No calls yet'), { flush: true, hint: 'per 1M tokens' })
    + card('What the AI is used for', bars(d.purposes.map((p) => [esc(p.key) + ' <span class="dim">· ' + n(p.calls) + ' calls</span>', p.cost]), usd, 'linear-gradient(90deg,#c084fc,#e9a8ff)'))
    + '</div>';
  h += card('Cost per account', d.accounts.length ? '<div class="tw"><table class="t" data-per="15"><thead><tr><th>Account</th><th class="r">Calls</th><th class="r">Failed</th><th class="r">Tokens in</th><th class="r">Tokens out</th><th class="r">Avg wait</th><th>Models</th><th class="r">Cost</th></tr></thead><tbody>'
      + d.accounts.map((r) => '<tr' + (r.acc.id ? ' data-acc="' + r.acc.id + '"' : '') + '><td>' + who(r.acc, r.acc.guest ? 'Guest' : (r.acc.username ? '@' + r.acc.username : '')) + '</td><td class="r num">' + n(r.calls) + '</td>'
        + '<td class="r num">' + (r.errors ? '<span class="chip ' + (r.errors / r.calls > 0.3 ? 'bad' : 'warn') + '">' + pct(r.errors, r.calls) + '</span>' : '<span class="dim">0</span>') + '</td>'
        + '<td class="r num">' + compact(r.in) + '</td><td class="r num">' + compact(r.out) + '</td><td class="r num dim">' + (r.lat / 1000).toFixed(1) + 's</td>'
        + '<td class="dim clip" style="max-width:220px">' + esc(Object.keys(r.models).join(', ')) + '</td><td class="r num"><b>' + usd(r.cost) + '</b></td></tr>').join('')
      + '</tbody></table></div>' : empty('No calls in this period'), { flush: true, right: '<a class="btn btn-g btn-s" href="?api=export&what=ai&range=' + d.range + '"><svg><use href="#i-down"/></svg>Export CSV</a>' });
  const st = d.setup;
  h += '<div class="grid g2" style="align-items:start">'
    + card('Recent failures', d.errors.length ? '<div class="tw"><table class="t"><thead><tr><th>When</th><th>Account</th><th>Model</th><th>Error</th></tr></thead><tbody>'
        + d.errors.slice(0, 15).map((e) => '<tr' + (+e.account_id ? ' data-acc="' + e.account_id + '"' : '') + '><td class="dim" style="white-space:nowrap">' + esc(ago(e.created_at)) + '</td><td>' + esc(e.who) + '</td><td class="mono dim">' + esc(e.model) + '</td><td class="clip" title="' + esc(e.error) + '">' + esc(e.error) + '</td></tr>').join('')
        + '</tbody></table></div>' : empty('No failures', 'Every recorded call went through.'), { flush: true })
    + card('How accounts are set up', '<dl class="kv">'
        + ps.map((p) => '<dt>Accounts with a ' + PROV[p][0] + ' key</dt><dd class="num">' + n(st.keys[p] || 0) + '</dd>').join('')
        + Object.entries(st.active).map((x) => '<dt>Using ' + esc(provName(x[0])) + (x[0] === 'builtin' ? '' : ' by default') + '</dt><dd class="num">' + n(x[1]) + '</dd>').join('')
        + '</dl><div style="margin-top:16px">' + bars(Object.entries(st.agent_models).map((x) => ['<span class="mono">' + esc(x[0] === 'builtin' ? 'Built-in AI' : x[0]) + '</span>', x[1]])) + '</div><p class="dim" style="font-size:12px;margin:10px 0 0">Models chosen by active agents.</p>')
    + '</div>';
  return h;
};

V.revenue = function (d) {
  const t = d.totals, f = d.invoices;
  let h = '<div class="grid g6">'
    + kpi({ label: 'Sales volume', icon: 'i-coin', value: usd(t.usd), hero: true, sub: t.other ? '+ ' + plural(t.other, 'order') + ' in other currencies' : 'completed orders' })
    + kpi({ label: 'Orders', icon: 'i-check', value: n(t.orders), spark: d.series.orders, sparkColor: C.money })
    + kpi({ label: 'Average order', icon: 'i-coin', value: usd(t.aov) })
    + kpi({ label: 'Paying customers', icon: 'i-users', value: n(t.customers), sub: 'across ' + plural(t.sellers, 'seller') })
    + (d.take_rate > 0 ? kpi({ label: 'Your earnings', icon: 'i-spark', value: usd(t.earn), sub: 'at ' + d.take_rate + '% of sales' })
                       : kpi({ label: 'Your earnings', icon: 'i-spark', value: '—', sub: '<a href="#/settings" style="text-decoration:underline">Set your take rate</a> to see them' }))
    + kpi({ label: t.llm_scope === 'builtin' ? 'Built-in AI cost, same period' : 'AI cost, same period', icon: 'i-bolt', value: usd(t.llm_cost), sub: esc(scopeOf(t.llm_scope)[1]), go: 'ai' })
    + '</div>';
  h += '<div class="grid g21">'
    + card('Sales', chart({ labels: d.series.labels, fmt: usd, series: [{ name: 'Sales', color: C.money, values: d.series.usd, type: 'bar' }, { name: 'Orders', color: C.tg, values: d.series.orders, fill: false, axis2: true, fmt: n }], emptyText: 'No sales in this period' }), { right: legend([['Sales (USD)', C.money], ['Orders', C.tg]]) })
    + card('Invoices', '<div class="meter" style="margin:4px 0 14px">' + [['confirmed', C.money], ['pending', C.warn], ['cancelled', '#475569'], ['expired', '#334155']].map((x) => '<i style="width:' + (f.created ? (f[x[0]] / f.created) * 100 : 0) + '%;background:' + x[1] + '"></i>').join('') + '</div>'
      + '<dl class="kv"><dt>Created</dt><dd class="num">' + n(f.created) + '</dd><dt>Paid</dt><dd class="num">' + n(f.confirmed) + ' · ' + pct(f.confirmed, f.created) + '</dd><dt>Waiting for payment</dt><dd class="num">' + n(f.pending) + ' · ' + usd(f.pending_usd) + '</dd>'
      + '<dt>Cancelled</dt><dd class="num">' + n(f.cancelled) + '</dd><dt>Expired</dt><dd class="num">' + n(f.expired) + '</dd></dl>'
      + '<div style="margin-top:16px">' + bars(Object.entries(d.coins).slice(0, 6).map((x) => [esc(x[0]) + ' <span class="dim">paid invoices</span>', x[1]])) + '</div>')
    + '</div>';
  h += '<div class="grid g2">'
    + card('Top sellers', d.accounts.length ? '<div class="tw"><table class="t"><thead><tr><th>Seller</th><th class="r">Orders</th><th class="r">Sales</th>' + (d.take_rate > 0 ? '<th class="r">Your cut</th>' : '') + '</tr></thead><tbody>'
        + d.accounts.map((r) => '<tr data-acc="' + r.acc.id + '"><td>' + who(r.acc, '@' + (r.acc.username || '')) + '</td><td class="r num">' + n(r.n) + '</td><td class="r num"><b>' + usd(r.usd, 1) + '</b></td>' + (d.take_rate > 0 ? '<td class="r num">' + usd(r.earn, 1) + '</td>' : '') + '</tr>').join('')
        + '</tbody></table></div>' : empty('No sales yet'), { flush: true })
    + '<div class="grid" style="align-content:start">'
    + card('Top products', bars(d.products.map((p) => [esc(p.name) + ' <span class="dim">· ' + esc(p.acc ? p.acc.name : '') + ' · ' + plural(p.n, 'order') + '</span>', p.usd]), (v) => usd(v, 1), 'linear-gradient(90deg,#86efac,#5eead4)'))
    + card('By channel', bars(Object.entries(d.channels).map((x) => [esc(x[0] === 'direct' ? 'Direct chats' : x[0].charAt(0).toUpperCase() + x[0].slice(1)), x[1]]), (v) => usd(v, 1)))
    + card('By currency', d.currencies.length ? '<dl class="kv">' + d.currencies.map((c) => '<dt>' + esc(c.cur) + ' · ' + plural(c.n, 'order') + '</dt><dd class="num">' + n(c.amount) + ' ' + esc(c.cur) + (c.converted ? (c.cur !== 'USD' ? ' <span class="dim">≈ ' + usd(c.usd) + '</span>' : '') : ' <span class="chip warn">no rate</span>') + '</dd>').join('') + '</dl>' : empty('No sales yet'))
    + '</div></div>';
  h += card('Latest orders', d.recent.length ? '<div class="tw"><table class="t" data-per="15"><thead><tr><th>When</th><th>Seller</th><th>Customer</th><th>Product</th><th>Channel</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>'
      + d.recent.map((r) => '<tr data-acc="' + r.account_id + '"><td class="dim" style="white-space:nowrap">' + esc(when(r.created_at)) + '</td><td>' + esc(r.acc ? r.acc.name : '#' + r.account_id) + '</td><td>' + esc(r.customer || '—') + '</td>'
        + '<td class="clip">' + esc(r.product || 'Custom order') + '</td><td>' + (r.channel ? plat(r.channel) : '<span class="dim">—</span>') + '</td><td class="r num">' + esc((r.amount || '') + ' ' + (r.currency || '')) + '</td>'
        + '<td>' + (r.paid ? '<span class="chip ok">Paid</span>' : '<span class="chip">' + esc(r.status) + '</span>') + '</td></tr>').join('')
      + '</tbody></table></div>' : empty('No orders in this period'), { flush: true, right: '<a class="btn btn-g btn-s" href="?api=export&what=sales&range=' + d.range + '"><svg><use href="#i-down"/></svg>Export CSV</a>' });
  return h;
};

V.messages = function (d) {
  const t = d.totals, s = d.series;
  const all = t.telegram + t.discord + t.direct;
  let h = '<div class="grid g6">'
    + kpi({ label: 'Messages', icon: 'i-chat', value: compact(all), hero: true, sub: n(t.inbound) + ' in · ' + n(t.outbound) + ' out on bots' })
    + kpi({ label: 'Telegram', icon: 'i-tg', value: compact(t.telegram), spark: s.telegram, sparkColor: C.tg })
    + kpi({ label: 'Discord', icon: 'i-dc', value: compact(t.discord), spark: s.discord, sparkColor: C.dc })
    + kpi({ label: 'Direct chats', icon: 'i-lock', value: compact(t.direct), spark: s.direct, sparkColor: C.dm })
    + kpi({ label: 'Written by agents', icon: 'i-spark', value: compact(t.ai), sub: pct(t.ai, all) + ' of all messages', spark: s.ai, sparkColor: C.ai })
    + kpi({ label: 'Failed to send', icon: 'i-alert', value: n(t.failed + t.outbox_failed), sub: n(t.failed) + ' in chats · ' + n(t.outbox_failed) + ' queued' })
    + '</div>';
  const busy = d.busy.length ? '<div class="rank" data-per="5">' + d.busy.map((b, i) => '<a data-open="' + esc(b.conv) + '" data-oacc="' + (b.acc ? b.acc.id : 0) + '" style="cursor:pointer"><span class="n">' + (i + 1) + '</span>'
      + '<span class="rk">' + platIco(b.platform) + '<span class="clip1">' + esc(b.name) + ' <span class="dim">· ' + esc(b.acc ? b.acc.name : '—') + '</span></span></span><b>' + n(b.n) + '</b></a>').join('') + '</div>'
    : empty('No conversations in this period');
  h += '<div class="grid g21" style="align-items:start">'
    + card('Messages by channel', chart({ labels: s.labels, size: 'lg', stacked: true, series: [{ name: 'Telegram', color: C.tg, values: s.telegram, type: 'bar' }, { name: 'Discord', color: C.dc, values: s.discord, type: 'bar' }, { name: 'Direct', color: C.dm, values: s.direct, type: 'bar' }, { name: 'By agents', color: C.ai, values: s.ai, fill: false, dash: true }], emptyText: 'No messages in this period' }),
        { right: legend([['Telegram', C.tg], ['Discord', C.dc], ['Direct', C.dm], ['By agents', C.ai]]) })
    + '<div class="grid" style="align-content:start">'
    + card('When people write', heatmap(d.heat), { hint: 'weekday × hour' })
    + card('Busiest conversations', busy, { flush: true })
    + '</div></div>';
  const m = S.msg;
  // One line per conversation, the one with the newest message on top.
  const fresh = (t) => Date.now() - S.skew - parseT(t) < 300000;
  const fromChip = (x) => x.role === 'in' ? '<span class="chip">Customer</span>' : x.agent_name ? '<span class="chip ai">' + esc(x.agent_name) + '</span>' : '<span class="chip info">Seller</span>';
  const list = d.convs.length ? '<div class="tw"><table class="t mconv" data-nopage><thead><tr><th>Conversation</th><th>Seller</th><th>Latest message</th><th class="r">30 days</th><th class="r">Last</th></tr></thead><tbody>'
      + d.convs.map((x) => '<tr data-open="' + esc(x.conv_id) + '" data-oacc="' + x.account_id + '">'
        + '<td class="clip" style="max-width:220px"><span class="mc">' + (fresh(x.created_at) ? '<i class="newdot" title="In the last 5 minutes"></i>' : '') + platIco(x.platform) + '<b>' + esc(x.name) + '</b>' + (x.handle ? ' <span class="dim">' + esc(x.handle) + '</span>' : '') + '</span></td>'
        + '<td class="clip dim" style="max-width:150px">' + esc(x.owner ? x.owner.name : '#' + x.account_id) + '</td>'
        + '<td class="clip" style="max-width:460px">' + fromChip(x) + ' ' + (x.media_type ? '<span class="chip">' + esc(x.media_type) + '</span> ' : '') + '<span class="mt">' + esc(x.content || '') + '</span></td>'
        + '<td class="r num dim" title="' + n(x.n_in) + ' from the customer">' + n(x.n) + '</td>'
        + '<td class="r dim" style="white-space:nowrap">' + esc(ago(x.created_at)) + '</td></tr>').join('')
      + '</tbody></table></div>'
      + (d.pages > 1 ? '<div class="pager"><span>' + n((d.page - 1) * d.per + 1) + '–' + n(Math.min(d.conv_total, d.page * d.per)) + ' of ' + n(d.conv_total) + ' conversations</span><span class="sp"></span>'
        + '<button class="btn btn-g btn-s" data-mpage="' + (d.page - 1) + '"' + (d.page <= 1 ? ' disabled' : '') + '>Previous</button><span>Page ' + d.page + ' of ' + d.pages + '</span>'
        + '<button class="btn btn-g btn-s" data-mpage="' + (d.page + 1) + '"' + (d.page >= d.pages ? ' disabled' : '') + '>Next</button></div>' : '')
    : empty('No messages found', m.q ? 'Nothing in the last 30 days matches.' : '');
  h += card('Latest messages', '<div class="toolbar" style="padding:0 14px 8px">' + tabs('mrole', m.role, [['', 'All'], ['in', 'From customers'], ['out', 'Sent'], ['ai', 'By agents']])
      + '<span class="grow"></span><input class="inp" id="msg-q" placeholder="Search the last 30 days" value="' + esc(m.q) + '"></div>' + list,
    { flush: true, hint: n(d.conv_total) + ' conversations · newest first · direct chats are encrypted' });
  return h;
};

// A bot's state now: receiving on the server, on the desktop app, erroring or off.
function botState(b) {
  if (b.state === 'desktop') return '<span class="chip ok" title="The desktop app is receiving for this bot"><i></i>Desktop app</span>';
  if (b.state === 'erroring') return '<span class="chip warn" title="' + esc(b.error || '') + '"><i></i>Erroring</span>';
  if (b.state === 'on') return '<span class="chip ok"><i></i>On</span>';
  return '<span class="chip">Off</span>';
}
V.system = function (d) {
  const r = d.relay;
  let h = '';
  if (!d.php.api_patched) h += '<div class="banner"><svg><use href="#i-alert"/></svg><span>The api.php next to this console is the old one: AI calls aren’t recorded, suspensions and the AI pause don’t take effect. Upload the new api.php.</span></div>';
  if (d.paused) h += '<div class="banner bad"><svg><use href="#i-pause"/></svg><span><b>All AI calls are paused.</b></span><button class="btn btn-g btn-s" data-act="resume-ai">Resume AI</button></div>';
  const bad = d.queues.filter((q) => /overdue|failed/i.test(q.label) && q.n > 0).length;
  h += '<div class="grid g6">'
    + kpi({ label: 'Bots running', icon: 'i-bot', value: n(r.on), hero: true, sub: n(r.off) + ' turned off' + (r.desktop ? ' · ' + n(r.desktop) + ' on the desktop app' : '') })
    + kpi({ label: 'Bots with errors', icon: 'i-alert', value: n(r.erroring), sub: n(r.stale) + ' not polled in 5 min' })
    + kpi({ label: 'Queue warnings', icon: 'i-list', value: n(bad), sub: bad ? 'see below' : 'all queues moving' })
    + kpi({ label: 'AI calls, last hour', icon: 'i-spark', value: n(d.llm_hour.calls), sub: n(d.llm_hour.errors) + ' failed · ' + (d.llm_hour.lat / 1000).toFixed(1) + 's average' })
    + kpi({ label: 'Database', icon: 'i-server', value: bytes(d.db.size), sub: d.db.tables.length + '+ tables' })
    + kpi({ label: 'Memory files', icon: 'i-list', value: compact(d.memory.files) + (d.memory.capped ? '+' : ''), sub: bytes(d.memory.bytes) })
    + '</div>';
  h += '<div class="grid g2">'
    + card('Background queues', '<div class="tw"><table class="t" data-nopage><tbody>' + d.queues.map((q) => {
        const warn = /overdue|failed/i.test(q.label) && q.n > 0;
        return '<tr><td>' + esc(q.label) + '</td><td class="r"><span class="chip ' + (warn ? 'bad' : q.n ? 'info' : '') + '">' + n(q.n) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>', { flush: true })
    + card('Server', '<dl class="kv"><dt>PHP</dt><dd>' + esc(d.php.version) + '</dd><dt>Database</dt><dd>' + esc(d.db.version) + '</dd><dt>Server time</dt><dd>' + esc(d.php.time) + ' (' + esc(d.php.tz) + ')</dd>'
        + '<dt>Database time</dt><dd>' + esc(d.db.time) + '</dd><dt>Memory limit</dt><dd>' + esc(d.php.memory_limit) + '</dd><dt>Max run time</dt><dd>' + esc(d.php.max_exec) + 's</dd><dt>Largest upload</dt><dd>' + esc(d.php.post_max) + '</dd>'
        + '<dt>Free disk</dt><dd>' + (d.php.disk_free ? bytes(d.php.disk_free) : '—') + '</dd><dt>cURL</dt><dd>' + (d.php.curl ? 'available' : '<span class="chip bad">missing</span>') + '</dd>'
        + '<dt>api.php</dt><dd>' + (d.php.api_patched ? '<span class="chip ok">Recording AI usage</span>' : '<span class="chip warn">Old version</span>') + '</dd></dl>')
    + '</div>';
  h += card('Bots', r.rows.length ? '<div class="tw"><table class="t"><thead><tr><th>Account</th><th>Bot</th><th>State</th><th>Token</th><th>Last poll</th><th class="r">Failures</th><th>Error now</th></tr></thead><tbody>'
      + r.rows.map((b) => '<tr data-acc="' + b.account_id + '"><td>' + esc(b.acc ? b.acc.name : '#' + b.account_id) + '</td><td>' + plat(b.platform) + ' ' + esc(b.bot_name || b.username || '') + '</td>'
        + '<td>' + botState(b) + '</td><td>' + (b.token ? '<span class="chip ok">Saved</span>' : '<span class="chip bad">None</span>') + '</td>'
        + '<td class="dim">' + esc(b.polled_at ? ago(b.polled_at) : 'never') + '</td><td class="r num">' + (b.error ? n(b.fails) : '<span class="dim">0</span>') + '</td><td class="clip dim" title="' + esc(b.error || '') + '">' + esc(b.error || '—') + '</td></tr>').join('')
      + '</tbody></table></div>' : empty('No bots connected'), { flush: true, hint: 'errors shown only while they still apply' });
  h += '<div class="grid g2" style="align-items:start">'
    + card('Largest tables', '<div class="tw"><table class="t"><thead><tr><th>Table</th><th class="r">Rows</th><th class="r">Size</th></tr></thead><tbody>'
        + d.db.tables.slice(0, 18).map((x) => '<tr><td class="mono">' + esc(x.name) + '</td><td class="r num">~' + compact(x.n) + '</td><td class="r num">' + bytes(+x.d + +x.i) + '</td></tr>').join('') + '</tbody></table></div>', { flush: true })
    + card('Schema changes that failed', d.migrate_log ? '<pre class="pre">' + esc(d.migrate_log) + '</pre>' : empty('None', 'migrate.log is empty.'), { hint: 'migrate.log' })
    + '</div>';
  return h;
};

V.audit = function (d) {
  const L = { login: 'Signed in', logout: 'Signed out', suspend: 'Suspended', unsuspend: 'Unsuspended', delete: 'Deleted', impersonate: 'Opened app as', reset_password: 'Password reset', bots_off: 'Bots off',
    clear_cooldowns: 'Cooldowns cleared', clear_limits: 'Limits reset', host_prefs: 'Contact page', purge_guests: 'Guests removed', llm_pause: 'AI switch', settings: 'Settings', builtin_llm: 'Built-in AI' };
  if (!d.rows.length) return card('', empty('Nothing yet', 'Actions taken here are listed as you make them.'));
  return card('', '<div class="tw"><table class="t" data-per="20"><thead><tr><th>When</th><th>Action</th><th>Account</th><th>Detail</th><th>From</th></tr></thead><tbody>'
    + d.rows.map((r) => '<tr' + (r.target && r.target.username ? ' data-acc="' + r.target.id + '"' : '') + '><td class="dim" style="white-space:nowrap">' + esc(when(r.created_at)) + '</td><td><span class="chip ' + (/delete|suspend$/.test(r.action) ? 'bad' : r.action === 'impersonate' ? 'warn' : 'info') + '">' + esc(L[r.action] || r.action) + '</span></td>'
      + '<td>' + (r.target ? esc(r.target.name) : '<span class="dim">—</span>') + '</td><td>' + esc(r.detail) + '</td><td class="mono dim">' + esc(r.ip) + '</td></tr>').join('')
    + '</tbody></table></div>', { flush: true });
};

V.settings = function (d) {
  S.set = JSON.parse(JSON.stringify(d));
  S.biClear = false;
  const sec = d.security, bi = d.builtin || {};
  let h = card('Built-in AI', '<p class="dim" style="margin:0 0 12px;font-size:12.5px">Your own AI key, offered to every account. In the app, accounts choose <b>Built-in AI</b> under Connections → AI provider instead of adding a key of their own. '
      + 'Calls on it are what you pay for, and are the cost shown across this console. The key stays on the server: it is never sent to the app or back to this page.</p>'
      + '<div class="row-f"><div class="tx"><b>Offer the built-in AI</b><span>' + (bi.users ? plural(bi.users, 'account') + ' chose it. Turning it off moves them back to their own keys, if they have any.' : 'No account uses it yet.') + '</span></div>'
      + '<button class="sw" role="switch" id="bi-on" data-act="bi-toggle" aria-checked="' + (bi.on ? 'true' : 'false') + '" aria-label="Offer the built-in AI"></button></div>'
      + '<div class="row-f"><div class="tx"><b>Provider and model</b><span id="bi-price">' + esc(biPriceText(d.prices, bi.model)) + '</span></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      + '<select class="inp" id="bi-prov" style="width:120px;height:32px">' + ['gemini', 'openai', 'claude'].map((x) => '<option value="' + x + '"' + (x === bi.provider ? ' selected' : '') + '>' + PROV[x][0] + '</option>').join('') + '</select>'
      + '<select class="inp mono" id="bi-model" style="width:230px;height:32px">' + biModelOptions(d.prices, bi.provider, bi.model) + '</select></div></div>'
      + '<div class="row-f"><div class="tx"><b>API key</b><span>' + (bi.has_key ? 'Saved (' + esc(bi.key_hint) + '). Leave the box empty to keep it.' : 'None saved yet.') + '</span></div><div style="display:flex;gap:8px;align-items:center">'
      + '<input class="inp mono" id="bi-key" type="password" autocomplete="new-password" placeholder="' + (bi.has_key ? 'Paste a new key to replace it' : 'Paste the API key') + '" style="width:260px;height:32px">'
      + (bi.has_key ? '<button class="btn btn-g btn-s" data-act="bi-clear" title="Remove the saved key (turns the built-in AI off)">Remove</button>' : '') + '</div></div>'
      + '<p class="dim" style="font-size:12px;margin:10px 0 0">Saved with <b>Save settings</b> below. Its price comes from the AI prices list.</p>');
  h += card('Live switches', '<div class="row-f"><div class="tx"><b>Pause all AI</b><span>Every agent on every account stops calling the AI until you turn this off. Customers simply get no reply.</span></div>'
      + '<button class="sw danger" role="switch" data-act="toggle-ai" aria-checked="' + (d.paused ? 'true' : 'false') + '" aria-label="Pause all AI"></button></div>'
      + '<div class="row-f"><div class="tx"><b>Live updates every</b><span>How often open pages refresh themselves.</span></div><div style="display:flex;gap:8px;align-items:center"><input class="inp" id="set-refresh" type="number" min="5" max="300" value="' + d.refresh + '" style="width:80px;height:32px"><span class="dim">seconds</span></div></div>'
      + '<div class="row-f"><div class="tx"><b>Your take rate</b><span>The share of sellers’ sales you count as your earnings (0 hides it). booqi itself doesn’t charge this; it’s for your own figures.</span></div><div style="display:flex;gap:8px;align-items:center"><input class="inp" id="set-take" type="number" min="0" max="100" step="0.1" value="' + d.take_rate + '" style="width:80px;height:32px"><span class="dim">%</span></div></div>');
  if (d.unpriced.length) h += '<div class="banner"><svg><use href="#i-alert"/></svg><span>' + plural(d.unpriced.length, 'model') + ' in use ' + (d.unpriced.length === 1 ? 'isn’t' : 'aren’t') + ' in the list and ' + (d.unpriced.length === 1 ? 'is' : 'are') + ' priced at a fallback: ' + esc(d.unpriced.map((x) => x.model).join(', ')) + '.</span><button class="btn btn-g btn-s" data-act="add-unpriced">Add ' + (d.unpriced.length === 1 ? 'it' : 'them') + '</button></div>';
  h += card('AI prices', '<p class="dim" style="margin:0 0 12px;font-size:12.5px">US dollars per million tokens. Defaults are the providers’ list prices when this console was written; check them against the providers’ pricing pages. Cached input is what a cache hit costs.</p>'
      + '<div class="tw"><table class="t price-t"><thead><tr><th>Model</th><th>Provider</th><th class="r">Input</th><th class="r">Cached input</th><th class="r">Output</th><th></th></tr></thead><tbody id="price-rows">' + priceRows(d.prices) + '</tbody></table></div>'
      + '<button class="btn btn-g btn-s" data-act="add-price" style="margin-top:10px">Add a model</button>');
  h += '<div class="grid g2">'
    + card('Currency rates', '<p class="dim" style="margin:0 0 12px;font-size:12.5px">USD for one unit. Sales in a currency without a rate are listed separately and left out of totals.</p><div class="tw"><table class="t price-t"><tbody id="fx-rows">'
        + Object.entries(d.fx).map((x) => fxRow(x[0], x[1])).join('') + '</tbody></table></div><button class="btn btn-g btn-s" data-act="add-fx" style="margin-top:10px">Add a currency</button>')
    + card('Security', '<dl class="kv"><dt>Username</dt><dd>' + esc(sec.username) + '</dd><dt>Password</dt><dd>' + (sec.hashed ? '<span class="chip ok">Stored as a hash</span>' : '<span class="chip warn">Plain text in admin.php</span>') + '</dd>'
        + '<dt>Address allow-list</dt><dd>' + (sec.allowlist ? plural(sec.allowlist, 'address', 'addresses') : '<span class="chip warn">Off</span>') + '</dd><dt>Your address</dt><dd class="mono">' + esc(sec.ip) + '</dd>'
        + '<dt>Signed out after</dt><dd>' + sec.hours + ' h, or ' + sec.idle + ' min idle</dd><dt>HTTPS</dt><dd>' + (sec.https ? '<span class="chip ok">Yes</span>' : '<span class="chip bad">No</span>') + '</dd></dl>'
        + '<p class="dim" style="font-size:12px;margin:12px 0 0">These are set at the top of admin.php. Changing the password there signs every console session out.</p>')
    + '</div>';
  h += '<div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-p" data-act="save-settings"><svg><use href="#i-check"/></svg>Save settings</button></div>';
  return h;
};
// Built-in AI: the models in your price list for a provider (and the one saved, if it isn't listed).
function biModelOptions(prices, provider, cur) {
  const list = (prices || []).filter((p) => p.provider === provider).map((p) => p.model);
  const elsewhere = (prices || []).some((p) => p.model === cur && p.provider !== provider);
  if (cur && !list.includes(cur) && !elsewhere) list.unshift(cur);
  return list.length ? list.map((m) => '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' + esc(m) + '</option>').join('') : '<option value="">(add a model for this provider to AI prices)</option>';
}
function biPriceText(prices, model) {
  const p = (prices || []).find((x) => x.model === model);
  return p ? '$' + (+p.in).toFixed(2) + ' in · $' + (+p.cached).toFixed(3) + ' cached · $' + (+p.out).toFixed(2) + ' out, per 1M tokens' : 'Not in your price list — priced at the provider’s fallback.';
}
function priceRows(list) {
  return list.map((p) => '<tr><td><input class="inp mono" data-f="model" value="' + esc(p.model) + '"></td><td><select class="inp" data-f="provider">' + ['gemini', 'openai', 'claude'].map((x) => '<option value="' + x + '"' + (x === p.provider ? ' selected' : '') + '>' + PROV[x][0] + '</option>').join('') + '</select></td>'
    + ['in', 'cached', 'out'].map((f) => '<td><input class="inp num" data-f="' + f + '" type="number" step="0.001" min="0" value="' + esc(p[f]) + '" style="text-align:right;width:100px;margin-left:auto;display:block"></td>').join('')
    + '<td class="r"><button class="btn btn-g btn-s btn-i" data-act="del-row" title="Remove"><svg><use href="#i-x"/></svg></button></td></tr>').join('');
}
function fxRow(k, v) {
  return '<tr><td><input class="inp mono" data-f="cur" value="' + esc(k) + '" style="width:90px"></td><td><input class="inp num" data-f="rate" type="number" step="0.0001" min="0" value="' + esc(v) + '" style="text-align:right"></td><td class="r"><button class="btn btn-g btn-s btn-i" data-act="del-row" title="Remove"><svg><use href="#i-x"/></svg></button></td></tr>';
}

// ══ ACCOUNT DRAWER ══════════════════════════════════════════
async function openAccount(id, keepTab) {
  const dr = $('#drawer');
  if (!keepTab) S.dtab = 'overview';
  S.drawer = { id: +id, data: null };
  if (!dr.classList.contains('on')) {
    dr.innerHTML = '<div class="dr-h"><div class="skel" style="width:46px;height:46px;border-radius:50%"></div><div style="flex:1"><div class="skel" style="height:18px;width:40%"></div><div class="skel" style="height:12px;width:60%;margin-top:8px"></div></div></div><div class="dr-b"><div class="skel" style="height:120px"></div><div class="skel" style="height:220px"></div></div>';
    dr.classList.add('on'); dr.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on');
  }
  try {
    const d = await api('account', { id: id });
    if (!S.drawer || S.drawer.id !== +id) return;
    S.drawer.data = d;
    renderDrawer();
  } catch (e) { toast(e.message, true); closeDrawer(); }
}
function closeDrawer() {
  S.drawer = null;
  $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on');
  if (/^#\/account\//.test(location.hash)) history.replaceState(null, '', '#/' + S.view + viewQuery());
}
function renderDrawer() {
  const d = S.drawer.data, a = d.acc, st = d.stats, dr = $('#drawer');
  const keepScroll = $('.dr-b', dr) ? $('.dr-b', dr).scrollTop : 0;
  const online = a.seen && (Date.now() - S.skew - parseT(a.seen)) < 300000;
  const meta = [a.guest ? 'Guest' + (a.host ? ' of ' + a.host.name : '') : '@' + a.username, a.email, '#' + a.id, 'joined ' + day(a.created), a.seen ? 'seen ' + ago(a.seen) : 'never seen'].filter(Boolean).join(' · ');
  let h = '<div class="dr-h">' + av(a) + '<div style="min-width:0"><h2>' + esc(a.name) + ' ' + (a.guest ? '<span class="chip guest">Guest</span>' : '') + (a.suspended ? '<span class="chip bad"><i></i>Suspended</span>' : '')
    + (online ? '<span class="chip ok"><i></i>Online</span>' : '') + (d.risk.score ? '<span class="chip ' + (d.risk.score >= 60 ? 'bad' : d.risk.score >= 30 ? 'warn' : 'info') + '">Risk ' + d.risk.score + '</span>' : '') + '</h2>'
    + '<div class="meta">' + esc(meta) + '</div>' + (a.suspended && a.suspend_reason ? '<div class="meta" style="color:#ffb4bc">Suspended ' + esc(ago(a.suspended_at)) + ': ' + esc(a.suspend_reason) + '</div>' : '') + '</div>'
    + '<button class="btn btn-g btn-i x" data-act="close-drawer" aria-label="Close"><svg><use href="#i-x"/></svg></button></div>';
  h += '<div class="dr-act">'
    + '<button class="btn btn-p btn-s" data-act="impersonate"' + (a.suspended ? ' disabled' : '') + '><svg><use href="#i-open"/></svg>Open the app as ' + esc(a.guest ? 'this guest' : a.name) + '</button>'
    + (a.suspended ? '<button class="btn btn-g btn-s" data-act="unsuspend"><svg><use href="#i-check"/></svg>Lift suspension</button>' : '<button class="btn btn-d btn-s" data-act="suspend" data-id="' + a.id + '" data-name="' + esc(a.name) + '"><svg><use href="#i-lock"/></svg>Suspend</button>')
    + (a.guest ? '' : '<button class="btn btn-g btn-s" data-act="reset-pw"><svg><use href="#i-key"/></svg>Set password</button>')
    + (d.bots.some((b) => +b.on_flag) ? '<button class="btn btn-g btn-s" data-act="bots-off"><svg><use href="#i-bot"/></svg>Turn bots off</button>' : '')
    + (d.cooldowns.length ? '<button class="btn btn-g btn-s" data-act="clear-cool"><svg><use href="#i-refresh"/></svg>Clear spam cooldowns</button>' : '')
    + (d.limits.length ? '<button class="btn btn-g btn-s" data-act="clear-limits"><svg><use href="#i-refresh"/></svg>Reset limits</button>' : '')
    + '<button class="btn btn-d btn-s" data-act="delete" style="margin-left:auto"><svg><use href="#i-trash"/></svg>Delete</button></div>';
  h += '<div class="dr-tabs">' + tabs('dtab', S.dtab, [['overview', 'Overview'], ['convs', 'Conversations', st.convs], ['sales', 'Sales', st.orders_all], ['ai', 'AI', d.llm.calls ? compact(d.llm.calls) : null],
    ['direct', 'Direct chats', d.threads.length], ['safety', 'Safety', d.risk.reasons.length || null], ['notes', 'Notes']]) + '</div>';
  h += '<div class="dr-b">' + (DT[S.dtab] || DT.overview)(d) + '</div>';
  dr.innerHTML = h;
  paginate(dr, 'dr:' + S.dtab);
  $('.dr-b', dr).scrollTop = keepScroll;
}
const DT = {};
DT.overview = function (d) {
  const st = d.stats, s = d.series, c = d.cred;
  let h = '<div class="grid g4">'
    + kpi({ label: 'Messages, all time', icon: 'i-chat', value: compact(st.msgs_all), spark: s.telegram.map((v, i) => v + s.discord[i] + s.direct[i]), sparkColor: C.tg })
    + kpi({ label: 'Sales, all time', icon: 'i-coin', value: usd(st.sales_all), sub: usd(st.sales_30d) + ' in 30 days', spark: s.sales, sparkColor: C.money })
    + kpi({ label: d.llm.scope === 'builtin' ? 'Built-in AI, 30 days' : 'AI cost, 30 days', icon: 'i-spark', value: usd(d.llm.cost), sub: usd(d.llm.cost_all) + ' all time', spark: d.llm.daily, sparkColor: C.ai })
    + kpi({ label: 'Customers', icon: 'i-users', value: n(st.customers), sub: n(st.convs) + ' chats · ' + n(st.licenses) + ' licences' })
    + '</div>';
  h += card('Messages, 30 days', chart({ labels: s.labels, size: 'sm', stacked: true, series: [{ name: 'Telegram', color: C.tg, values: s.telegram, type: 'bar' }, { name: 'Discord', color: C.dc, values: s.discord, type: 'bar' },
    { name: 'Direct', color: C.dm, values: s.direct, type: 'bar' }, { name: 'By agents', color: C.ai, values: s.ai, fill: false, dash: true }], emptyText: 'No messages in 30 days' }), { right: legend([['Telegram', C.tg], ['Discord', C.dc], ['Direct', C.dm], ['By agents', C.ai]]) });
  const prof = d.profile || {};
  const pv = c.llm_active || '';
  h += '<div class="grid g2">'
    + card('AI setup', '<dl class="kv"><dt>Default provider</dt><dd>' + (pv ? esc(provName(pv)) + (pv === 'builtin' ? ' <span class="chip info">your key</span>' : '') : '<span class="dim">not set</span>') + '</dd>'
      + ['gemini', 'openai', 'claude'].map((p) => '<dt>' + PROV[p][0] + ' key</dt><dd class="mono">' + (c['llm_' + p] ? esc(c['llm_' + p]) + (c['llm_' + p + '_model'] ? ' <span class="dim">· ' + esc(c['llm_' + p + '_model']) + '</span>' : '') : '<span class="dim">—</span>') + '</dd>').join('')
      + '</dl>')
    + card('Channels', '<dl class="kv">' + (d.bots.length ? d.bots.map((b) => '<dt>' + plat(b.platform) + ' ' + esc(b.bot_name || b.username || '') + '</dt><dd>' + botState(b)
        + (b.token ? ' <span class="chip ok" title="A bot token is saved">Token saved</span>' : ' <span class="chip bad" title="No bot token is saved for this bot">No token</span>')
        + ' <span class="dim">' + esc(b.polled_at ? ago(b.polled_at) : '') + '</span>' + (b.error ? '<div class="dim" style="font-size:12px;margin-top:3px">' + esc(b.error) + '</div>' : '') + '</dd>').join('') : '<dt>Bots</dt><dd class="dim">none connected</dd>')
      + (d.acc.guest ? '' : '<dt>Contact page</dt><dd>' + hostSwitch('discoverable', prof.discoverable) + '</dd><dt>Guests may write</dt><dd>' + hostSwitch('allow_guests', prof.allow_guests) + '</dd><dt>Agent answers guests</dt><dd>' + hostSwitch('guest_ai', prof.guest_ai) + '</dd>')
      + '</dl>')
    + '</div>';
  if (d.agents.length) h += card('Agents', '<div class="tw"><table class="t"><thead><tr><th>Agent</th><th>Model</th><th class="r">Replies</th><th class="r">Chats</th><th>State</th></tr></thead><tbody>'
    + d.agents.map((g) => '<tr><td>' + esc(g.name) + '</td><td class="mono dim">' + esc(g.model === 'builtin' ? 'Built-in AI' : (g.model || 'default')) + '</td><td class="r num">' + n(g.replies) + '</td><td class="r num">' + n(g.conv) + '</td><td>' + (+g.active ? '<span class="chip ok">Active</span>' : '<span class="chip">Off</span>') + '</td></tr>').join('')
    + '</tbody></table></div>', { flush: true });
  if (d.products.length) h += card('Products', '<div class="tw"><table class="t"><thead><tr><th>Product</th><th>Type</th><th class="r">Price</th><th>Billing</th><th class="r">Stock</th><th>Agents sell it</th></tr></thead><tbody>'
    + d.products.map((p) => '<tr><td class="clip">' + esc(p.name) + '</td><td class="dim">' + esc(p.type) + '</td><td class="r num">' + esc(p.price) + ' ' + esc(p.currency || '') + '</td><td class="dim">' + esc(p.billing || '—') + '</td><td class="r num">' + esc(p.stock) + '</td><td>' + (+p.enabled ? '<span class="chip ok">Yes</span>' : '<span class="chip">No</span>') + '</td></tr>').join('')
    + '</tbody></table></div>', { flush: true });
  if (d.acc.guest && d.acc.host) h += card('Guest of', whoLink(d.acc.host));
  return h;
};
function hostSwitch(col, v) { const on = v == null ? true : +v === 1; return '<button class="sw" role="switch" data-act="host-pref" data-col="' + col + '" aria-checked="' + (on ? 'true' : 'false') + '" style="display:inline-block;vertical-align:middle"></button>'; }
DT.convs = function (d) {
  if (!d.convs.length) return card('', empty('No conversations', 'This account hasn’t talked to anyone on Telegram or Discord yet.'));
  return card('', '<div class="tw"><table class="t"><thead><tr><th>Contact</th><th>Channel</th><th>Stage</th><th>Agent</th><th>Last message</th><th>Updated</th></tr></thead><tbody>'
    + d.convs.map((c) => '<tr data-open="' + esc(c.id) + '" data-oacc="' + d.acc.id + '"><td>' + esc(c.name || c.id) + (c.handle ? ' <span class="dim">' + esc(c.handle) + '</span>' : '') + '</td><td>' + plat(c.platform) + '</td><td class="dim">' + esc(c.stage) + '</td>'
      + '<td>' + (+c.auto_reply ? '<span class="chip ok">Replying</span>' : '<span class="chip">Off</span>') + '</td><td class="clip" style="max-width:280px">' + esc(c.last_msg || '') + '</td><td class="dim" style="white-space:nowrap">' + esc(ago(c.updated_at)) + '</td></tr>').join('')
    + '</tbody></table></div>' + (d.stats.convs > d.convs.length ? '<div class="pager">Showing the latest ' + d.convs.length + ' of ' + n(d.stats.convs) + '</div>' : ''), { flush: true });
};
DT.sales = function (d) {
  const st = d.stats, ic = d.invoice_counts;
  let h = '<div class="grid g4">' + kpi({ label: 'Sales, all time', value: usd(st.sales_all), sub: plural(st.orders_all, 'order') + (st.other_currency ? ' · ' + st.other_currency + ' in other currencies' : '') })
    + kpi({ label: 'Last 30 days', value: usd(st.sales_30d), sub: plural(st.orders_30d, 'order') }) + kpi({ label: 'Invoices paid', value: n(ic.confirmed), sub: n(ic.pending) + ' waiting' })
    + kpi({ label: 'Blocked customers', value: n(st.blocked_customers) }) + '</div>';
  h += card('Sales, 30 days', chart({ labels: d.series.labels, size: 'sm', fmt: usd, series: [{ name: 'Sales', color: C.money, values: d.series.sales, type: 'bar' }], emptyText: 'No sales in 30 days' }));
  h += card('Orders', d.sales.length ? '<div class="tw"><table class="t"><thead><tr><th>When</th><th>Customer</th><th>Product</th><th class="r">Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>'
    + d.sales.map((r) => '<tr><td class="dim" style="white-space:nowrap">' + esc(when(r.created_at)) + '</td><td>' + esc(r.customer || '—') + '</td><td class="clip">' + esc(r.product || 'Custom order') + '</td><td class="r num">' + esc((r.amount || '') + ' ' + (r.currency || '')) + '</td>'
      + '<td>' + (r.paid ? '<span class="chip ok">Paid</span>' : '<span class="chip">' + esc(r.status) + '</span>') + '</td><td class="mono dim clip" style="max-width:160px">' + esc(r.reference || '') + '</td></tr>').join('')
    + '</tbody></table></div>' : empty('No orders yet'), { flush: true });
  h += card('Invoices', d.invoices.length ? '<div class="tw"><table class="t"><thead><tr><th>Created</th><th>For</th><th>Coin</th><th class="r">Amount</th><th>Status</th><th>Agent</th></tr></thead><tbody>'
    + d.invoices.map((i) => '<tr><td class="dim" style="white-space:nowrap">' + esc(i.created ? ago(new Date(i.created * 1000).toISOString().slice(0, 19).replace('T', ' ')) : '—') + '</td><td class="clip">' + esc(i.desc || '—') + '</td><td class="mono">' + esc(i.coin) + '</td>'
      + '<td class="r num">' + esc(i.amount + ' ' + i.fiat) + '</td><td><span class="chip ' + (i.status === 'confirmed' ? 'ok' : i.status === 'pending' ? 'warn' : '') + '">' + esc(i.status === 'confirmed' ? 'Paid' : i.status) + '</span></td><td class="dim">' + esc(i.agent || '—') + '</td></tr>').join('')
    + '</tbody></table></div>' : empty('No invoices'), { flush: true });
  return h;
};
DT.ai = function (d) {
  const l = d.llm;
  let h = '<p class="dim" style="font-size:12.5px;margin:0 0 10px">Counting calls ' + esc(scopeOf(l.scope)[1]) + '. Change it on the <a href="#/ai" style="text-decoration:underline">AI page</a>.</p>'
    + '<div class="grid g4">' + kpi({ label: 'Cost, 30 days', value: usd(l.cost), sub: usd(l.cost_all) + ' all time' }) + kpi({ label: 'Calls', value: n(l.calls), sub: pct(l.errors, l.calls) + ' failed' })
    + kpi({ label: 'Tokens in', value: compact(l.in) }) + kpi({ label: 'Tokens out', value: compact(l.out) }) + '</div>';
  h += card('AI cost per day', chart({ labels: d.series.labels, size: 'sm', fmt: usd, series: [{ name: 'Cost', color: C.ai, values: l.daily }], emptyText: 'No AI calls recorded in 30 days' }));
  h += card('Models', l.models.length ? '<div class="tw"><table class="t"><thead><tr><th>Model</th><th class="r">Calls</th><th class="r">Tokens</th><th class="r">Avg wait</th><th class="r">Cost</th></tr></thead><tbody>'
    + l.models.map((m) => '<tr><td class="mono">' + esc(m.model) + '</td><td class="r num">' + n(m.calls) + '</td><td class="r num">' + compact(m.tokens) + '</td><td class="r num dim">' + (m.calls ? (m.lat / m.calls / 1000).toFixed(1) : 0) + 's</td><td class="r num"><b>' + usd(m.cost) + '</b></td></tr>').join('')
    + '</tbody></table></div>' : empty('No calls yet'), { flush: true });
  if (l.errors_recent.length) h += card('Recent failures', '<div class="tw"><table class="t"><tbody>' + l.errors_recent.map((e) => '<tr><td class="dim" style="white-space:nowrap">' + esc(ago(e.created_at)) + '</td><td class="mono dim">' + esc(e.model) + '</td><td class="clip" title="' + esc(e.error) + '">' + esc(e.error) + '</td></tr>').join('') + '</tbody></table></div>', { flush: true });
  return h;
};
DT.direct = function (d) {
  let h = '<div class="banner info"><svg><use href="#i-lock"/></svg><span>Direct chats are end-to-end encrypted: you can see who talks to whom and how much, never what was said.</span></div>';
  h += card('Direct chats', d.threads.length ? '<div class="tw"><table class="t"><thead><tr><th>With</th><th class="r">Messages</th><th>Blocked</th><th>Last activity</th></tr></thead><tbody>'
    + d.threads.map((t) => '<tr data-acc="' + t.peer.id + '"><td>' + who(t.peer, t.peer.guest ? 'Guest' : (t.peer.username ? '@' + t.peer.username : '')) + '</td><td class="r num">' + n(t.n) + '</td>'
      + '<td>' + (+t.i_blocked ? '<span class="chip warn">They’re blocked</span> ' : '') + (+t.they_blocked ? '<span class="chip bad">Blocked this account</span>' : '') + (!+t.i_blocked && !+t.they_blocked ? '<span class="dim">—</span>' : '') + '</td>'
      + '<td class="dim">' + esc(ago(t.updated)) + '</td></tr>').join('') + '</tbody></table></div>' : empty('No direct chats'), { flush: true });
  if (d.guests.length) h += card('Guests who wrote to this account', '<div class="rank">' + d.guests.map((g, i) => '<a href="#/account/' + g.id + '"><span class="n">' + (i + 1) + '</span>' + who(g, 'started ' + ago(g.created)) + '<b>' + (g.suspended ? '<span class="chip bad">Suspended</span>' : '') + '</b></a>').join('') + '</div>', { flush: true });
  return h;
};
DT.safety = function (d) {
  const r = d.risk;
  let h = card('Risk score', '<div style="display:flex;align-items:center;gap:16px;margin-bottom:' + (r.reasons.length ? 14 : 0) + 'px"><div style="font-size:34px;font-weight:650;letter-spacing:-.03em;color:' + RISK_C[lvl(r.score)] + '">' + r.score + '</div>'
    + '<div class="dim" style="font-size:12.5px">' + ({ high: 'High risk. Worth a look.', medium: 'Medium risk.', low: 'One small signal.', none: 'No signals of spam or abuse.' })[lvl(r.score)] + (d.acc.ip_cluster > 1 ? '<br>' + plural(d.acc.ip_cluster, 'account') + ' were created from the same address.' : '') + '</div></div>'
    + (r.reasons.length ? '<div class="reasons">' + r.reasons.map((x) => '<span class="chip ' + (x.pts >= 25 ? 'bad' : x.pts >= 15 ? 'warn' : 'info') + '">+' + x.pts + ' · ' + esc(x.why) + '</span>').join('') + '</div>' : ''));
  h += card('Spam cooldowns in this account’s chats', d.cooldowns.length ? '<div class="tw"><table class="t"><thead><tr><th>Where</th><th class="r">Hits</th><th>Reason</th><th>Until</th></tr></thead><tbody>'
    + d.cooldowns.map((c) => '<tr><td class="mono">' + esc(c.where) + '</td><td class="r num">' + n(c.hits) + '</td><td class="clip">' + esc(c.reason || '—') + '</td><td class="dim">' + esc(c.until ? when(c.until) : '—') + '</td></tr>').join('')
    + '</tbody></table></div>' : empty('None'), { flush: true });
  h += card('Rate-limit counters', d.limits.length ? '<div class="tw"><table class="t"><thead><tr><th>Counter</th><th class="r">Count</th><th>Window started</th></tr></thead><tbody>'
    + d.limits.map((l) => '<tr><td class="mono">' + esc(l.k) + '</td><td class="r num">' + n(l.n) + '</td><td class="dim">' + esc(when(l.since)) + '</td></tr>').join('') + '</tbody></table></div>' : empty('No counters running'), { flush: true, hint: 'gm = messages, ga = agent replies, gao = replies to all of their guests' });
  return h;
};
DT.notes = function (d) {
  return card('Private note', '<textarea class="inp" id="acc-note" rows="7" placeholder="Only you can see this.">' + esc(d.note) + '</textarea><div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn btn-p btn-s" data-act="save-note">Save note</button></div>')
    + card('What you’ve done here', d.audit.length ? '<div class="tw"><table class="t"><tbody>' + d.audit.map((x) => '<tr><td class="dim" style="white-space:nowrap">' + esc(when(x.created_at)) + '</td><td>' + esc(x.detail) + '</td></tr>').join('') + '</tbody></table></div>' : empty('Nothing yet'), { flush: true });
};

// ── Conversation viewer ─────────────────────────────────────
async function openConversation(acc, conv) {
  let d;
  try { d = await api('conversation', { acc: acc, conv: conv }); } catch (e) { return toast(e.message, true); }
  const c = d.conv;
  const body = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:-2px 0 6px">' + plat(c.platform) + '<span class="chip">' + esc(c.stage || 'new') + '</span>' + (+c.auto_reply ? '<span class="chip ok">Agent replying</span>' : '<span class="chip">Agent off</span>')
    + (d.customer && +d.customer.is_blocked ? '<span class="chip bad">Blocked</span>' : '') + (d.owner ? '<span class="chip info">Seller: ' + esc(d.owner.name) + '</span>' : '') + '</div>'
    + (c.mem_summary ? '<p style="font-size:12px;margin:6px 0 0">' + esc(c.mem_summary) + '</p>' : '')
    + '</div><div class="chat">' + (d.messages.length ? d.messages.map((m) => {
      const cls = m.role === 'in' ? 'in' : m.role === 'bot' ? 'bot' : 'out';
      const lab = m.role === 'in' ? (c.name || 'Customer') : m.role === 'bot' ? 'System' : (m.agent_name || 'Seller');
      return '<div class="bub ' + cls + (+m.send_failed ? ' failed' : '') + (m.deleted_at ? ' deleted' : '') + '"><small>' + esc(lab) + ' · ' + esc(when(m.created_at)) + (m.edited_at ? ' · edited' : '') + (+m.send_failed ? ' · not delivered' : '') + '</small>'
        + (m.media_type ? '<span class="chip">' + esc(m.media_type) + (m.media_name ? ': ' + esc(m.media_name) : '') + '</span>\n' : '') + esc(m.content) + '</div>';
    }).join('') : empty('No messages stored')) + '</div><div>';
  const showSeller = d.owner && !(S.drawer && S.drawer.id === d.owner.id);
  ask({ title: (c.name || c.id) + (c.handle ? ' · ' + c.handle : ''), html: body, wide: true, ok: showSeller ? 'Open seller' : false, cancel: 'Close',
        onOpen: (w) => { const ch = $('.chat', w); if (ch) ch.scrollTop = ch.scrollHeight; } })
    .then((v) => { if (v && showSeller) location.hash = '#/account/' + d.owner.id; });
}

// ══ ROUTING, LOADING, LIVE ══════════════════════════════════
function viewQuery() {
  if (S.view === 'accounts' && S.acc.type !== 'accounts') return '?type=' + S.acc.type;
  return '';
}
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^account\/(\d+)/);
  if (m) { if (!S.data) go(S.view, true); openAccount(+m[1]); return; }
  const [v, qs] = h.split('?');
  const view = VIEWS[v] ? v : 'overview';
  if (qs) { const p = new URLSearchParams(qs); if (view === 'accounts' && p.get('type')) { S.acc.type = p.get('type'); S.acc.page = 1; } }
  if (S.drawer) closeDrawer();
  go(view);
}
function go(view, quiet) {
  const changed = S.view !== view || !S.data;
  if (S.view !== view) S.pg = {};
  S.view = view;
  $$('.nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.v === view ? 'page' : 'false'));
  $('#title').textContent = VIEWS[view][0];
  $('#subtitle').textContent = VIEWS[view][1];
  $('#range-slot').innerHTML = RANGED[view] ? seg('range', S.ranges[view], [['24h', '24 h'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['365d', 'Year']]) : '';
  $('#side').classList.remove('on');
  if (changed && !quiet) { $('#page').innerHTML = '<div class="grid g6">' + '<div class="skel" style="height:104px"></div>'.repeat(6) + '</div><div class="skel" style="height:300px"></div><div class="skel" style="height:240px"></div>'; window.scrollTo(0, 0); }
  load(!changed);
}
function params() {
  switch (S.view) {
    case 'accounts': return { type: S.acc.type, sort: S.acc.sort, dir: S.acc.dir, page: S.acc.page, q: S.acc.q };
    case 'guests': return { filter: S.guests.filter, q: S.guests.q };
    case 'messages': return { range: S.ranges.messages, q: S.msg.q, role: S.msg.role, page: S.msg.page || 1 };
    case 'ai': case 'revenue': return { range: S.ranges[S.view] };
    default: return {};
  }
}
async function load(silent) {
  const id = ++S.reqId, view = S.view;
  const live = $('#live');
  live.classList.add('busy');
  try {
    const d = await api(view, params());
    if (id !== S.reqId || view !== S.view) return;
    S.data = d; S.lastAt = Date.now();
    render(silent);
  } catch (e) {
    if (id !== S.reqId) return;
    if (!silent) $('#page').innerHTML = card('', empty('This page didn’t load', e.message));
    else toast(e.message, true);
  } finally { live.classList.remove('busy'); tickLive(); }
}
function render(silent) {
  const y = window.scrollY;
  S.charts = {}; S.chartN = 0;
  $('#page').innerHTML = V[S.view](S.data);
  paginate($('#page'), S.view);
  if (silent) window.scrollTo(0, y);
}

// ── Pages for long lists ─────────────────────────────────────
// Every table, feed and ranking with more rows than fit is shown a page
// at a time, with a small pager under it. Which page each list is on is
// kept (by view and card title) across live refreshes.
const PG_PER = { tr: 10, ev: 8, a: 8 };
function paginate(root, prefix) {
  const seen = {};
  $$('table.t:not([data-nopage]):not(.price-t) > tbody, .feed, .rank', root).forEach((box) => {
    const kind = box.tagName === 'TBODY' ? 'tr' : box.classList.contains('feed') ? 'ev' : 'a';
    const title = (box.closest('.card') && $('.card-h h2', box.closest('.card'))) ? $('.card-h h2', box.closest('.card')).textContent : 'list';
    let key = prefix + ':' + title;
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) key += ':' + seen[key];
    box.dataset.pgk = key;
    pageBox(box);
  });
}
function pageBox(box) {
  const kind = box.tagName === 'TBODY' ? 'tr' : box.classList.contains('feed') ? 'ev' : 'a';
  const items = Array.from(box.children);
  const per = +(box.closest('[data-per]') || {}).dataset?.per || PG_PER[kind];
  const host = box.tagName === 'TBODY' ? (box.closest('.tw') || box.closest('table')) : box;
  const old = host.nextElementSibling && host.nextElementSibling.classList.contains('pg') ? host.nextElementSibling : null;
  const key = box.dataset.pgk;
  if (items.length <= per) { items.forEach((x) => { x.hidden = false; }); if (old) old.remove(); return; }
  const pages = Math.ceil(items.length / per);
  const p = Math.min(Math.max(1, S.pg[key] || 1), pages);
  S.pg[key] = p;
  items.forEach((x, i) => { x.hidden = i < (p - 1) * per || i >= p * per; });
  const bar = document.createElement('div');
  bar.className = 'pager pg';
  bar.innerHTML = '<span>' + n((p - 1) * per + 1) + '–' + n(Math.min(items.length, p * per)) + ' of ' + n(items.length) + '</span><span class="sp"></span>'
    + '<button class="btn btn-g btn-s btn-i" data-pg="' + esc(key) + '" data-p="' + (p - 1) + '" title="Previous page"' + (p <= 1 ? ' disabled' : '') + '>‹</button>'
    + '<span class="pgn">' + p + ' / ' + pages + '</span>'
    + '<button class="btn btn-g btn-s btn-i" data-pg="' + esc(key) + '" data-p="' + (p + 1) + '" title="Next page"' + (p >= pages ? ' disabled' : '') + '>›</button>';
  if (old) old.replaceWith(bar); else host.after(bar);
}
function pageTo(key, p) {
  S.pg[key] = p;
  const box = $$('[data-pgk]').find((b) => b.dataset.pgk === key);
  if (box) pageBox(box);
}
function busyTyping() { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'gsearch'; }
async function refreshLive() {
  if (!S.live || document.hidden || S.modal || busyTyping()) return;
  if (S.view === 'settings') return;           // never overwrite edits in progress
  await load(true);
  if (S.drawer && S.drawer.data) {
    try { const d = await api('account', { id: S.drawer.id }); if (S.drawer && S.drawer.id === d.acc.id) { S.drawer.data = d; if (!busyTyping() && !S.modal) renderDrawer(); } } catch (e) {}
  }
}
function tickLive() {
  const el = $('#live'), s = $('span', el);
  el.classList.toggle('off', !S.live);
  if (!S.live) { s.textContent = 'Paused'; return; }
  const sec = S.lastAt ? Math.round((Date.now() - S.lastAt) / 1000) : 0;
  s.textContent = S.lastAt ? 'Live · ' + (sec < 5 ? 'just now' : sec + 's ago') : 'Live';
}
async function boot() {
  try {
    const b = await api('boot');
    S.boot = b;
    $('#n-acc').textContent = b.accounts ? compact(b.accounts) : '';
    $('#n-guest').textContent = b.guests ? compact(b.guests) : '';
    const r = $('#n-risk'); r.textContent = b.risk_high ? b.risk_high : ''; r.classList.toggle('hot', b.risk_high > 0);
    setAiSwitch(b.paused);
  } catch (e) {}
}
function setAiSwitch(paused) {
  $('#ai-pause').setAttribute('aria-checked', paused ? 'true' : 'false');
  $('#ai-state').textContent = paused ? 'AI is paused' : 'AI is running';
  $('#ai-sub').textContent = paused ? 'No agent replies anywhere' : 'Agents reply as normal';
}

// ══ ACTIONS ═════════════════════════════════════════════════
async function toggleAi(on) {
  if (on) {
    const ok = await ask({ title: 'Pause all AI?', body: 'Every agent on every account stops replying until you turn it back on. Customers get no answer in the meantime.', ok: 'Pause AI', danger: true });
    if (!ok) return;
  }
  try { await post('llm_pause', { on: on }); setAiSwitch(on); toast(on ? 'All AI calls paused' : 'AI calls resumed'); if (S.boot) S.boot.paused = on; load(true); } catch (e) { toast(e.message, true); }
}
async function suspend(id, name) {
  const why = await ask({ title: 'Suspend ' + name + '?', body: 'They’re signed out straight away and can’t sign back in. Their agents stop replying. Nothing is deleted, and you can lift it any time.',
    input: { label: 'Reason (shown to them when they try to sign in)', placeholder: 'Optional' }, ok: 'Suspend', danger: true });
  if (why === null) return;
  try { await post('suspend', { id: id, reason: why || '' }); toast(name + ' is suspended'); afterChange(id); } catch (e) { toast(e.message, true); }
}
function afterChange(id) { boot(); load(true); if (S.drawer && (!id || S.drawer.id === +id)) openAccount(S.drawer.id, true); }
async function drawerAction(act, el) {
  const d = S.drawer && S.drawer.data; if (!d) return;
  const a = d.acc, id = a.id;
  try {
    if (act === 'impersonate') {
      const ok = await ask({ title: 'Open the app as ' + a.name + '?', ok: 'Open the app', html: '<p>This browser is signed in to the app as them, in a new tab. Your own app sign-in on this browser is replaced; sign out there when you’re done.</p><p>Their direct chats stay locked: they’re encrypted with their password.</p>' });
      if (!ok) return;
      const r = await post('impersonate', { id: id });
      window.open(r.url || BQ.app, '_blank', 'noopener');
      toast('Opened the app as ' + a.name);
    } else if (act === 'unsuspend') {
      await post('unsuspend', { id: id }); toast('Suspension lifted'); afterChange(id);
    } else if (act === 'reset-pw') {
      const pw = await ask({ title: 'Set a new password for ' + a.name, html: '<p>Tell them the new password yourself. Their old direct-chat history is encrypted with the old password and can’t be opened with the new one.</p>', input: { label: 'New password (8 characters or more)', type: 'text' }, ok: 'Set password', danger: true });
      if (!pw) return;
      await post('reset_password', { id: id, password: pw }); toast('Password changed');
    } else if (act === 'bots-off') {
      if (!await ask({ title: 'Turn off ' + a.name + '’s bots?', body: 'Their Telegram and Discord bots stop receiving messages. They can turn them back on in the app.', ok: 'Turn off', danger: true })) return;
      await post('bots_off', { id: id }); toast('Bots turned off'); afterChange(id);
    } else if (act === 'clear-cool') {
      const r = await post('clear_cooldowns', { id: id }); toast(plural(r.n, 'cooldown') + ' cleared'); afterChange(id);
    } else if (act === 'clear-limits') {
      await post('clear_limits', { id: id }); toast('Limits reset'); afterChange(id);
    } else if (act === 'delete') {
      const v = await ask({ title: 'Delete ' + a.name + ' for good?', danger: true, ok: 'Delete everything',
        html: '<p>This removes the account and everything it owns: conversations, customers, products, agents, sales records, direct chats and files. It can’t be undone.</p>' + (a.guest ? '' : '<p>If you only want to stop them, suspend the account instead.</p>'),
        input: { label: 'Type ' + a.username + ' to confirm', match: a.username } });
      if (v === null) return;
      await post('delete_account', { id: id, confirm: v.trim() });
      toast(a.name + ' was deleted'); closeDrawer(); boot(); load(true);
    } else if (act === 'save-note') {
      await post('note', { id: id, note: $('#acc-note').value }); toast('Note saved');
    } else if (act === 'host-pref') {
      const on = el.getAttribute('aria-checked') !== 'true';
      const b = { id: id }; b[el.dataset.col] = on;
      await post('host_prefs', b); el.setAttribute('aria-checked', on ? 'true' : 'false'); toast('Saved');
    }
  } catch (e) { toast(e.message, true); }
}
function collectSettings() {
  const prices = $$('#price-rows tr').map((tr) => { const o = {}; $$('[data-f]', tr).forEach((i) => { o[i.dataset.f] = i.value; }); return o; }).filter((p) => p.model && p.model.trim());
  const fx = {};
  $$('#fx-rows tr').forEach((tr) => { const c = $('[data-f="cur"]', tr).value.trim().toUpperCase(), r = $('[data-f="rate"]', tr).value; if (c && r) fx[c] = +r; });
  const b = { prices: prices, fx: fx, take_rate: $('#set-take').value, refresh: $('#set-refresh').value };
  if ($('#bi-on')) b.builtin = { on: $('#bi-on').getAttribute('aria-checked') === 'true', provider: $('#bi-prov').value, model: $('#bi-model').value, key: $('#bi-key').value.trim(), clear_key: !!S.biClear };
  return b;
}

// ══ EVENTS ══════════════════════════════════════════════════
document.addEventListener('click', async (e) => {
  const t = e.target;
  const segB = t.closest('[data-seg]');
  if (segB) {
    const k = segB.dataset.seg, v = segB.dataset.val;
    if (k === 'range') { S.ranges[S.view] = v; go(S.view); }
    if (k === 'top') { S.topTab = v; render(true); }
    if (k === 'aiscope') { try { await post('ai_scope', { scope: v }); load(true); } catch (err) { toast(err.message, true); } }
    return;
  }
  const tab = t.closest('[data-tab]');
  if (tab) {
    const k = tab.dataset.tab, v = tab.dataset.val;
    if (k === 'acctype') { S.acc.type = v; S.acc.page = 1; history.replaceState(null, '', '#/accounts' + viewQuery()); load(); }
    else if (k === 'gfilter') { S.guests.filter = v; load(); }
    else if (k === 'mrole') { S.msg.role = v; S.msg.page = 1; load(); }
    else if (k === 'dtab') { S.dtab = v; renderDrawer(); $('.dr-b').scrollTop = 0; }
    return;
  }
  const sortTh = t.closest('th[data-sort]');
  if (sortTh) { const k = sortTh.dataset.sort; if (S.acc.sort === k) S.acc.dir = S.acc.dir === 'asc' ? 'desc' : 'asc'; else { S.acc.sort = k; S.acc.dir = k === 'name' ? 'asc' : 'desc'; } S.acc.page = 1; load(); return; }
  const mp = t.closest('[data-mpage]');
  if (mp) { S.msg.page = Math.max(1, +mp.dataset.mpage); load(true); return; }
  const pgb = t.closest('[data-pg]');
  if (pgb) { pageTo(pgb.dataset.pg, +pgb.dataset.p); return; }
  const pg = t.closest('[data-page]');
  if (pg) { S.acc.page = +pg.dataset.page; load(); window.scrollTo(0, 0); return; }
  const kg = t.closest('.kpi[data-go]');
  if (kg) { location.hash = '#/' + kg.dataset.go; return; }
  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    e.preventDefault(); e.stopPropagation();
    if (a === 'close-drawer') return closeDrawer();
    if (a === 'resume-ai') return toggleAi(false);
    if (a === 'toggle-ai') return toggleAi(act.getAttribute('aria-checked') !== 'true');
    if (a === 'suspend') return suspend(+act.dataset.id, act.dataset.name);
    if (['impersonate', 'unsuspend', 'reset-pw', 'bots-off', 'clear-cool', 'clear-limits', 'delete', 'save-note', 'host-pref'].includes(a)) return drawerAction(a, act);
    if (a === 'del-guest') {
      const v = await ask({ title: 'Delete guest ' + act.dataset.u + '?', body: 'Their chat is removed for the person they were writing to as well.', ok: 'Delete', danger: true });
      if (!v) return;
      try { await post('delete_account', { id: +act.dataset.id, confirm: act.dataset.u }); toast('Guest deleted'); boot(); load(true); } catch (err) { toast(err.message, true); }
      return;
    }
    if (a === 'purge') {
      const mode = act.dataset.mode, days = +(mode === 'silent' ? $('#pg-days') : $('#pg-days2')).value || 0;
      const ok = await ask({ title: mode === 'silent' ? 'Remove silent guests?' : 'Remove unclaimed guests?', danger: mode !== 'silent', ok: 'Remove',
        body: mode === 'silent' ? 'Guests older than ' + days + ' days who never sent or received a message.' : 'Every unclaimed guest older than ' + days + ' days, with their conversations. This can’t be undone.' });
      if (!ok) return;
      try { const r = await post('purge_guests', { mode: mode, days: days }); toast(plural(r.n, 'guest') + ' removed' + (r.more ? ' (run again for more)' : '')); boot(); load(true); } catch (err) { toast(err.message, true); }
      return;
    }
    if (a === 'add-price') { $('#price-rows').insertAdjacentHTML('beforeend', priceRows([{ model: '', provider: 'gemini', in: 0, cached: 0, out: 0 }])); $('#price-rows tr:last-child input').focus(); return; }
    if (a === 'add-unpriced') { $('#price-rows').insertAdjacentHTML('beforeend', priceRows(S.data.unpriced.map((x) => ({ model: x.model, provider: x.provider, in: 0, cached: 0, out: 0 })))); toast('Added — fill in the prices and save'); return; }
    if (a === 'add-fx') { $('#fx-rows').insertAdjacentHTML('beforeend', fxRow('', '')); $('#fx-rows tr:last-child input').focus(); return; }
    if (a === 'del-row') { act.closest('tr').remove(); return; }
    if (a === 'bi-toggle') { act.setAttribute('aria-checked', act.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); return; }
    if (a === 'bi-clear') {
      if (!await ask({ title: 'Remove the built-in AI key?', body: 'The built-in AI is turned off when you save. Accounts that chose it go back to their own keys, if they have any.', ok: 'Remove', danger: true })) return;
      S.biClear = true; $('#bi-on').setAttribute('aria-checked', 'false'); act.disabled = true; toast('Key will be removed when you save');
      return;
    }
    if (a === 'save-settings') {
      try { const b = collectSettings(); await post('settings_save', b); S.refresh = Math.max(5, +b.refresh || 15); restartTimer(); toast('Settings saved'); load(); } catch (err) { toast(err.message, true); }
      return;
    }
    return;
  }
  const open = t.closest('[data-open]');
  if (open) { openConversation(+open.dataset.oacc, open.dataset.open); return; }
  if (t.closest('[data-stop]')) return;
  const accEl = t.closest('[data-acc]');
  if (accEl && !t.closest('a')) { const id = +accEl.dataset.acc; if (id) location.hash = '#/account/' + id; return; }
});
$('#scrim').addEventListener('click', closeDrawer);
$('#ai-pause').addEventListener('click', (e) => { e.stopPropagation(); toggleAi(e.currentTarget.getAttribute('aria-checked') !== 'true'); });
$('#live').addEventListener('click', () => { S.live = !S.live; tickLive(); if (S.live) refreshLive(); });
$('#menu').addEventListener('click', () => $('#side').classList.toggle('on'));
document.addEventListener('change', (e) => {
  if (e.target.id === 'bi-prov' && S.set) { $('#bi-model').innerHTML = biModelOptions(S.set.prices, e.target.value, ''); $('#bi-price').textContent = biPriceText(S.set.prices, $('#bi-model').value); }
  if (e.target.id === 'bi-model' && S.set) $('#bi-price').textContent = biPriceText(S.set.prices, e.target.value);
});
let qT = null;
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'acc-q' || id === 'guest-q' || id === 'msg-q') {
    clearTimeout(qT);
    qT = setTimeout(() => {
      if (id === 'acc-q') { S.acc.q = e.target.value; S.acc.page = 1; }
      if (id === 'guest-q') S.guests.q = e.target.value;
      if (id === 'msg-q') { S.msg.q = e.target.value; S.msg.page = 1; }
      const pos = e.target.selectionStart;
      load(true).then(() => { const el = $('#' + id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) {} } });
    }, id === 'msg-q' ? 450 : 250);
  }
});
// Global account search
(function () {
  const inp = $('#gsearch'), box = $('#sres');
  let t = null, sel = 0, rows = [];
  const draw = () => {
    box.innerHTML = rows.length ? rows.map((r, i) => '<a href="#/account/' + r.id + '" class="' + (i === sel ? 'sel' : '') + '">' + who(r, (r.guest ? 'Guest · ' : '@' + r.username + ' · ') + '#' + r.id) + (r.suspended ? '<span class="chip bad" style="margin-left:auto">Suspended</span>' : '') + '</a>').join('') : '<div class="none">No account matches</div>';
    box.classList.add('on');
  };
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const q = inp.value.trim();
    if (!q) { box.classList.remove('on'); return; }
    t = setTimeout(async () => { try { rows = (await api('search', { q: q })).rows; sel = 0; draw(); } catch (e) {} }, 160);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && rows[sel]) { location.hash = '#/account/' + rows[sel].id; inp.value = ''; box.classList.remove('on'); inp.blur(); }
    else if (e.key === 'Escape') { inp.value = ''; box.classList.remove('on'); inp.blur(); }
  });
  box.addEventListener('click', () => { inp.value = ''; box.classList.remove('on'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.classList.remove('on'); });
})();
document.addEventListener('keydown', (e) => {
  if (S.modal) return;
  if (e.key === '/' && !busyTyping() && document.activeElement !== $('#gsearch')) { e.preventDefault(); $('#gsearch').focus(); }
  if (e.key === 'Escape' && S.drawer) closeDrawer();
});
let timer = null;
function restartTimer() { clearInterval(timer); timer = setInterval(refreshLive, S.refresh * 1000); }
setInterval(tickLive, 1000);
setInterval(boot, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.live && Date.now() - S.lastAt > S.refresh * 1000) refreshLive(); });
window.addEventListener('hashchange', route);
restartTimer();
boot().then(() => { if (S.data) render(true); });
route();
})();
</script>
</body>
</html>
<?php endif; ?>