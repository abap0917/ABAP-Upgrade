@echo off
REM Start MCP ABAP ADT in HTTP (StreamableHTTP) mode for remote/team usage.
REM Point any agent at http://127.0.0.1:3000/mcp/stream/http (see agent-configs/http-remote.json)
REM NODE_TLS_REJECT_UNAUTHORIZED=0 allows self-signed certificates (SAP_INSECURE=true)
set NODE_TLS_REJECT_UNAUTHORIZED=0
REM RFC bridge backend must be set BEFORE node starts (module-load time); default soap (/sap/bc/soap/rfc)
set SAP_RFC_BACKEND=soap
cd /d "%~dp0.."
node "C:\path\to\your\your-abap-mcp\adt-dev\dist\server\launcher.js" --transport=http --port 3000 --host 127.0.0.1 --env-path="%~dp0..\.env"