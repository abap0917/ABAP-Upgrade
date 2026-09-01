#Requires -Version 5.1
<#
================================================================================
 system-init.ps1 — SAP MCP 连接初始化向导 (可分享版本)
================================================================================
 流程(与 docs\SYSTEM_INIT_AGENT.md 步骤 0~5 对应):
   步骤0  系统探测:ADT 可达性 / 认证握手 / RFC 后端前提
   步骤1  收集并确认 .env 配置(SAP_URL / CLIENT / 账号 / 系统上下文 / RFC 后端)
   步骤2  确认 MCP 读取路径(launcher.js / .env / agent-configs)
   步骤3  写入 .env + .sc4sap\sap.env(解决 SAP_PASSWORD 白名单坑)
   步骤4  自动更新全部 agent-configs(*.json)
   步骤5  按用户选择验证(启动级 / 只读 / 含读写)

 默认值策略(便于分享):
   - 若本机已存在 mcp-pack\.env,自动读取其值作为默认(本人机器方便);
   - 否则使用通用占位,提示用户输入(分享副本无 .env,不会泄露任何信息)。

 用法:
   powershell -ExecutionPolicy Bypass -File .\scripts\system-init.ps1
   (交互式;所有输入均有默认值,直接回车用默认)
================================================================================
#>

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)

# ---------------------------------------------------------------- 默认值 ----
function Get-Defaults {
  $envPath = Join-Path $ProjectRoot 'mcp-pack\.env'
  $d = @{
    SapUrl       = 'https://<host>:<port>'
    Client       = '100'
    Language     = 'EN'
    SystemType   = 'onprem'            # onprem | cloud | legacy
    MasterSystem = ''
    Responsible  = ''
    Launcher     = ''
    EnvPath      = $envPath
    Sc4sapEnv    = (Join-Path $ProjectRoot 'mcp-pack\.sc4sap\sap.env')
    AgentDir     = (Join-Path $ProjectRoot 'mcp-pack\agent-configs')
  }
  # 尝试自动定位常见服务器路径(仅本机)
  $auto = Join-Path $env:USERPROFILE 'Desktop\your-abap-mcp\adt-dev\dist\server\launcher.js'
  if (Test-Path $auto) { $d.Launcher = $auto }

  # 若本机已有 .env,自动读取默认值
  if (Test-Path $envPath) {
    $parsed = @{}
    foreach ($line in Get-Content $envPath) {
      $t = $line.Trim()
      if ($t -and -not $t.StartsWith('#') -and $t -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $parsed[$Matches[1]] = $Matches[2].Trim()
      }
    }
    if ($parsed['SAP_URL'])           { $d.SapUrl       = $parsed['SAP_URL'] }
    if ($parsed['SAP_CLIENT'])        { $d.Client       = $parsed['SAP_CLIENT'] }
    if ($parsed['SAP_LANGUAGE'])      { $d.Language     = $parsed['SAP_LANGUAGE'] }
    if ($parsed['SAP_SYSTEM_TYPE'])   { $d.SystemType   = $parsed['SAP_SYSTEM_TYPE'] }
    if ($parsed['SAP_MASTER_SYSTEM']) { $d.MasterSystem = $parsed['SAP_MASTER_SYSTEM'] }
    if ($parsed['SAP_RESPONSIBLE'])   { $d.Responsible  = $parsed['SAP_RESPONSIBLE'] }
  }
  return $d
}
$D = Get-Defaults

function Read-Val([string]$label, [string]$default) {
  $v = Read-Host -Prompt $label
  if ([string]::IsNullOrWhiteSpace($v)) { return $default }
  return $v.Trim()
}

function Read-Secret([string]$label) {
  $s = Read-Host -Prompt $label -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# 通用 HTTP 探测(返回状态码;走 curl.exe,容忍自签名)
function Test-Http([string]$url, [string]$cred, [hashtable]$headers = @{}) {
  $hdrArgs = @()
  foreach ($k in $headers.Keys) { $hdrArgs += @('-H', "$k=$($headers[$k])") }
  $code = & curl.exe -sk -o NUL -w "%{http_code}" --max-time 25 -u $cred @hdrArgs $url 2>$null
  return $code
}

function Write-EnvFile([string]$path, [System.Collections.Specialized.OrderedDictionary]$pairs, [string]$header) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# ============================================================")
  [void]$sb.AppendLine("# $header")
  [void]$sb.AppendLine("# 由 system-init.ps1 生成 @ $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
  [void]$sb.AppendLine("# ============================================================")
  foreach ($k in $pairs.Keys) { [void]$sb.AppendLine("$k=$($pairs[$k])") }
  $dir = Split-Path $path -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, $sb.ToString(), $utf8)
}

function Show-Summary([System.Collections.Specialized.OrderedDictionary]$p) {
  Write-Host ""
  Write-Host "==================== 配置确认 ====================" -ForegroundColor Cyan
  foreach ($k in $p.Keys) {
    $v = $p[$k]
    if ($k -eq 'Password') { $v = '******' }
    Write-Host ("  {0,-28} {1}" -f $k, $v)
  }
  Write-Host "==================================================" -ForegroundColor Cyan
}

# ---------------------------------------------------------------- 步骤 0 ----
Write-Host ""
Write-Host "=== SAP MCP 连接初始化向导 ===" -ForegroundColor Green
Write-Host "项目根: $ProjectRoot"

Write-Host ""
Write-Host "--- 步骤0:系统探测 ---" -ForegroundColor Yellow
$sapUrl = Read-Val  "SAP 系统 URL        (默认 $($D.SapUrl))"            $D.SapUrl
$client = Read-Val  "SAP Client          (默认 $($D.Client))"            $D.Client
$user   = Read-Val  "SAP 用户名          (默认 $($D.Responsible))"       $D.Responsible
$pass   = Read-Secret "SAP 密码"
if ([string]::IsNullOrEmpty($pass)) { Write-Host "[ERR] 密码不能为空" -ForegroundColor Red; exit 1 }

$cred = "$user`:$pass"
$discUrl = "$sapUrl/sap/bc/adt/discovery?sap-client=$client"
Write-Host "  [探测] ADT discovery: $discUrl"
$code = Test-Http $discUrl $cred
Write-Host "  ADT discovery -> HTTP $code (期望 200)"
if ($code -ne '200') {
  Write-Host "  [FAIL] ADT 不可达或认证失败。请检查 URL/端口/账号/网络,或 TLS 自签名(已自动忽略证书)。" -ForegroundColor Red
  $go = Read-Val "  仍要继续?(y/N)" 'N'
  if ($go -ne 'y' -and $go -ne 'Y') { exit 1 }
}

# ---------------------------------------------------------------- 步骤 1 ----
Write-Host ""
Write-Host "--- 步骤1:收集 .env 配置 ---" -ForegroundColor Yellow
$lang   = Read-Val "SAP 语言            (默认 $($D.Language))"           $D.Language
$sysTyp = Read-Val "系统类型 onprem/cloud/legacy (默认 $($D.SystemType))" $D.SystemType
$master = Read-Val "SAP_MASTER_SYSTEM(SID, onprem 建对象用)"               $D.MasterSystem
$resp   = Read-Val "SAP_RESPONSIBLE     (默认同用户名)"                    $D.Responsible
if ([string]::IsNullOrEmpty($resp)) { $resp = $user }

# RFC 后端选择(运行时询问)
Write-Host ""
Write-Host "--- RFC 桥接后端选择 ---" -ForegroundColor Yellow
Write-Host "  soap : /sap/bc/soap/rfc(零安装,需 ICF 节点激活)"
Write-Host "  odata: /sap/opu/odata/sap/ZMCP_ADT_SRV(需服务端已装并注册)"
$backend = Read-Val "选择后端 soap/odata (默认 soap)" 'soap'
$backend = $backend.ToLower()
if ($backend -notin @('soap','odata')) { Write-Host "[ERR] 只能选 soap 或 odata" -ForegroundColor Red; exit 1 }

$odataUrl = ''
if ($backend -eq 'odata') {
  $odataUrl = Read-Val "OData 服务 URL (默认 $sapUrl/sap/opu/odata/sap/ZMCP_ADT_SRV)" "$sapUrl/sap/opu/odata/sap/ZMCP_ADT_SRV"
  Write-Host "  [探测] OData `$metadata"
  $m = Test-Http "$odataUrl/`$metadata?sap-client=$client" $cred
  Write-Host "  OData `$metadata -> HTTP $m (期望 200)"
  if ($m -ne '200') {
    Write-Host "  [WARN] 服务不可达(404/403=未注册;500=MPC 问题)。可继续,但测试会失败。" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [探测] SOAP 端点 /sap/bc/soap/rfc"
  $s = Test-Http "$sapUrl/sap/bc/soap/rfc?sap-client=$client" $cred
  Write-Host "  /sap/bc/soap/rfc -> HTTP $s (期望 415=端点存在)"
}

# ---------------------------------------------------------------- 步骤 2 ----
Write-Host ""
Write-Host "--- 步骤2:确认 MCP 读取路径 ---" -ForegroundColor Yellow
$launcher = Read-Val "launcher.js 路径    (默认 $($D.Launcher))"          $D.Launcher
$envPath  = Read-Val ".env 文件路径      (默认 $($D.EnvPath))"            $D.EnvPath
$agentDir = Read-Val "agent-configs 目录  (默认 $($D.AgentDir))"           $D.AgentDir
if (-not (Test-Path $launcher))  { Write-Host "[WARN] launcher.js 不存在: $launcher" -ForegroundColor Yellow }
if (-not (Test-Path $agentDir))  { Write-Host "[WARN] agent-configs 目录不存在: $agentDir" -ForegroundColor Yellow }

# 密码注入方式(.env 白名单坑:SAP_PASSWORD 不生效 → 需 .sc4sap 或 agent env)
Write-Host ""
Write-Host "--- 密码注入方式(.env 里的 SAP_PASSWORD 不会进 process.env)---" -ForegroundColor Yellow
Write-Host "  A) .sc4sap\sap.env(推荐;全量生效,需服务器 cwd=mcp-pack)"
Write-Host "  B) agent 配置 env 字段(随客户端启动注入)"
Write-Host "  C) 两者都写"
$pwMode = (Read-Val "选择 A/B/C (默认 A)" 'A').ToUpper()
if ($pwMode -notin @('A','B','C')) { $pwMode = 'A' }

# ---------------------------------------------------------------- 确认 ----
$cfg = [System.Collections.Specialized.OrderedDictionary]::new()
$cfg['SAP_URL']             = $sapUrl
$cfg['SAP_CLIENT']          = $client
$cfg['SAP_LANGUAGE']        = $lang
$cfg['SAP_SYSTEM_TYPE']     = $sysTyp
$cfg['SAP_USERNAME']        = $user
$cfg['Password']            = '***'
$cfg['SAP_MASTER_SYSTEM']   = $master
$cfg['SAP_RESPONSIBLE']     = $resp
$cfg['SAP_RFC_BACKEND']     = $backend
if ($backend -eq 'odata') { $cfg['SAP_RFC_ODATA_SERVICE_URL'] = $odataUrl }
$cfg['launcher.js']         = $launcher
$cfg['.env 路径']            = $envPath
$cfg['agent-configs 目录']   = $agentDir
$cfg['密码注入方式']          = $pwMode
Show-Summary $cfg

$ok = Read-Val "确认无误?输入 y 写入配置,其他取消" 'N'
if ($ok -ne 'y' -and $ok -ne 'Y') { Write-Host "已取消,未做任何修改。"; exit 0 }

# ---------------------------------------------------------------- 步骤 3 ----
Write-Host ""
Write-Host "--- 步骤3:写入 .env ---" -ForegroundColor Yellow
$envPairs = [System.Collections.Specialized.OrderedDictionary]::new()
$envPairs['SAP_URL']           = $sapUrl
$envPairs['SAP_CLIENT']        = $client
$envPairs['SAP_LANGUAGE']      = $lang
$envPairs['SAP_SYSTEM_TYPE']   = $sysTyp
$envPairs['SAP_AUTH_TYPE']     = 'basic'
$envPairs['SAP_USERNAME']      = $user
$envPairs['SAP_PASSWORD']      = $pass
$envPairs['SAP_MASTER_SYSTEM'] = $master
$envPairs['SAP_RESPONSIBLE']   = $resp
if ($backend -eq 'odata') { $envPairs['SAP_RFC_ODATA_SERVICE_URL'] = $odataUrl }
Write-EnvFile $envPath $envPairs "SAP MCP 连接配置(实际使用)"
Write-Host "  [OK] 已写入 $envPath"

# .sc4sap\sap.env(方式 A/C)
if ($pwMode -in @('A','C')) {
  $scPairs = [System.Collections.Specialized.OrderedDictionary]::new()
  $scPairs['SAP_PASSWORD'] = $pass
  if ($backend -eq 'odata') { $scPairs['SAP_RFC_ODATA_SERVICE_URL'] = $odataUrl }
  Write-EnvFile $D.Sc4sapEnv $scPairs "sc4sap 覆盖层(全量生效)"
  Write-Host "  [OK] 已写入 $($D.Sc4sapEnv)(SAP_PASSWORD 全量生效)"
}

# ---------------------------------------------------------------- 步骤 4 ----
Write-Host ""
Write-Host "--- 步骤4:自动配置全部 agent-configs ---" -ForegroundColor Yellow
$launcherJs = $launcher.Replace('\','/')
$envPathJs  = $envPath.Replace('\','/')
$updated = 0; $skipped = 0
Get-ChildItem "$agentDir\*.json" -ErrorAction SilentlyContinue | ForEach-Object {
  $file = $_.FullName
  try { $j = Get-Content $file -Raw | ConvertFrom-Json } catch { $skipped++; Write-Host "  [skip] $($_.Name)(无法解析)"; return }
  $changed = $false
  foreach ($prop in $j.mcpServers.PSObject.Properties) {
    $srv = $prop.Value
    if ($srv.args) {
      $newArgs = @()
      foreach ($a in $srv.args) {
        if ($a -match 'launcher\.js') { $newArgs += $launcherJs; $changed = $true }
        elseif ($a -match '^--env-path=') { $newArgs += "--env-path=$envPathJs"; $changed = $true }
        else { $newArgs += $a }
      }
      $srv.args = $newArgs
    }
    if ($srv.env -is [psobject]) {
      $envObj = $srv.env
      if (-not $envObj.PSObject.Properties['NODE_TLS_REJECT_UNAUTHORIZED']) {
        $envObj | Add-Member -NotePropertyName 'NODE_TLS_REJECT_UNAUTHORIZED' -NotePropertyValue '0'
        $changed = $true
      }
      if ($backend -eq 'odata' -and -not $envObj.PSObject.Properties['SAP_RFC_BACKEND']) {
        $envObj | Add-Member -NotePropertyName 'SAP_RFC_BACKEND' -NotePropertyValue 'odata'
        $changed = $true
      }
      if ($pwMode -in @('B','C') -and -not $envObj.PSObject.Properties['SAP_PASSWORD']) {
        $envObj | Add-Member -NotePropertyName 'SAP_PASSWORD' -NotePropertyValue $pass
        $changed = $true
      }
    }
  }
  if ($changed) {
    $out = $j | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($file, $out, $utf8)
    $updated++
    Write-Host "  [OK] $($_.Name)"
  } else {
    Write-Host "  [--] $($_.Name)(无需变更)"
  }
}
Write-Host "  完成:更新 $updated 份,跳过 $skipped 份"

# ---------------------------------------------------------------- 步骤 5 ----
Write-Host ""
Write-Host "--- 步骤5:验证(三选一)---" -ForegroundColor Yellow
Write-Host "  1) 仅启动级: node launcher.js --version(验证模块加载与后端解析)"
Write-Host "  2) 只读验证: 启动级 + ADT discovery + RFC 桥端点(推荐)"
Write-Host "  3) 含读写验证: 只读 + 提示在客户端做临时对象创建/删除"
$vMode = Read-Val "选择 1/2/3 (默认 2)" '2'

Write-Host ""
Write-Host "--- 运行验证 ---" -ForegroundColor Yellow

# 启动级:模块加载 + 后端解析(非法 SAP_RFC_BACKEND 会在此暴露)
Write-Host "  [1/3] 启动级(node launcher.js --version)..."
$ver = & node $launcher --version 2>&1
if ($LASTEXITCODE -eq 0 -and $ver) {
  Write-Host "  [OK] 服务器模块加载正常,版本: $ver" -ForegroundColor Green
} else {
  Write-Host "  [FAIL] 启动失败: $ver" -ForegroundColor Red
  Write-Host "         常见: SAP_RFC_BACKEND 非法(模块加载时抛错); launcher 路径错。"
}

if ($vMode -ge '2') {
  Write-Host "  [2/3] ADT 可达性..."
  $c1 = Test-Http $discUrl $cred
  if ($c1 -eq '200') { Write-Host "  [OK] ADT discovery HTTP 200" -ForegroundColor Green }
  else { Write-Host "  [FAIL] ADT discovery HTTP $c1" -ForegroundColor Red }

  Write-Host "  [3/3] RFC 桥端点..."
  if ($backend -eq 'odata') {
    $m = Test-Http "$odataUrl/`$metadata?sap-client=$client" $cred
    if ($m -eq '200') { Write-Host "  [OK] OData `$metadata HTTP 200" -ForegroundColor Green }
    else { Write-Host "  [FAIL] OData `$metadata HTTP $m" -ForegroundColor Red }
  } else {
    $s = Test-Http "$sapUrl/sap/bc/soap/rfc?sap-client=$client" $cred
    if ($s -eq '415') { Write-Host "  [OK] /sap/bc/soap/rfc HTTP 415(端点存在)" -ForegroundColor Green }
    else { Write-Host "  [FAIL] /sap/bc/soap/rfc HTTP $s" -ForegroundColor Red }
  }
}

if ($vMode -ge '3') {
  Write-Host ""
  Write-Host "  [读写验证] 请在 MCP 客户端中手动完成:" -ForegroundColor Yellow
  Write-Host "    1) 重启客户端(让 env 注入生效)"
  Write-Host "    2) 调用 CreateProgram 在 `$TMP 建临时程序(如 ZTEST_INIT_<随机>)"
  Write-Host "    3) 调用 SearchObject 确认存在"
  Write-Host "    4) 调用 DeleteProgram 删除,收尾"
  Write-Host "  (脚本无法代替客户端做 MCP 级读写,由你/AI 客户端执行)"
}

# ---------------------------------------------------------------- 收尾 ----
Write-Host ""
Write-Host "=== 完成 ===" -ForegroundColor Green
Write-Host "后续提醒:"
Write-Host "  - .env / .sc4sap\sap.env 含密码,勿提交 git(已在 .gitignore)"
Write-Host "  - SAP_RFC_BACKEND 必须在 node 启动前注入(agent env 字段或启动脚本 set)"
Write-Host "  - 服务器 cwd 需为 mcp-pack(.sc4sap 才生效): 用 scripts\start-http.cmd 等"
Write-Host "  - Screen/GUI Status 工具在当前系统不可用(标准 FM 环境限制),TextElement 可用"
Write-Host "  - 详细步骤见 docs\SYSTEM_INIT_AGENT.md"
