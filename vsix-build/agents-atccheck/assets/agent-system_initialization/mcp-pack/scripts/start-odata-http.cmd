@echo off
REM Start MCP ABAP ADT with OData RFC backend (HTTP mode, port 3000).
REM
REM PREREQUISITE: SAP side must have OData v2 service ZMCP_ADT_SRV active
REM (FunctionImports Dispatch / Textpool -> ZMCP_ADT_DISPATCH / ZMCP_ADT_TEXTPOOL).
REM
REM KEY POINT: SAP_RFC_BACKEND is read at module-load time (process start),
REM so it MUST be set here BEFORE `node` starts. Putting it in .env or
REM .sc4sap\sap.env has NO effect (those load later inside main()).
REM SAP_RFC_ODATA_SERVICE_URL can stay in .env (read per-request).
set NODE_TLS_REJECT_UNAUTHORIZED=0
set SAP_RFC_BACKEND=odata
cd /d "%~dp0.."
node "C:\path\to\your\your-abap-mcp\adt-dev\dist\server\launcher.js" --transport=http --port 3000 --host 127.0.0.1 --env-path="%~dp0..\.env"
