@echo off
REM Start MCP ABAP ADT in SSE mode.
REM Point any agent at http://127.0.0.1:3001/sse
REM NODE_TLS_REJECT_UNAUTHORIZED=0 allows self-signed certificates (SAP_INSECURE=true)
set NODE_TLS_REJECT_UNAUTHORIZED=0
cd /d "%~dp0.."
node "C:\path\to\your\ABAP-MCP2\adt-dev\dist\server\launcher.js" --transport=sse --port 3001 --host 127.0.0.1 --env-path="%~dp0..\.env"