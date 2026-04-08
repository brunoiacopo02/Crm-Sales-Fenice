# Script di configurazione MCP per Claude Code
# Questo script aggancia il database Supabase e (opzionalmente) GitHub a Claude Code.

$ErrorActionPreference = "Stop"

Write-Host "Inizio configurazione dei Model Context Protocol (MCP) per Claude Code..." -ForegroundColor Cyan

# 1. Recupero variabile d'ambiente DATABASE_URL dal file .env
$envFile = "$PSScriptRoot\.env"
if (Test-Path $envFile) {
    Write-Host "Trovato file .env, estrazione stringa di connessione PostgreSQL..."
    $dbUrlLine = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
    if ($dbUrlLine) {
        # Estrae la stringa rimuovendo DATABASE_URL= e eventuali doppie virgolette
        $dbUrl = $dbUrlLine.Line.Substring(13).Trim('"')
        
        Write-Host "Configurazione del server MCP PostgreSQL..." -ForegroundColor Yellow
        # Configura Claude Code per usare npx @modelcontextprotocol/server-postgres
        # Nota: Esegue il comando claude CLI che deve essere installato globalmente via npm
        try {
            claude mcp add db npx -y @modelcontextprotocol/server-postgres $dbUrl
            Write-Host "✅ Supabase/PostgreSQL MCP installato correttamente!" -ForegroundColor Green
        } catch {
            Write-Host "⚠️ Errore nell'aggiunta del MCP PostgreSQL. Assicurati che 'claude' sia installato (npm install -g @anthropic-ai/claude-code)." -ForegroundColor Red
        }
    } else {
        Write-Host "⚠️ DATABASE_URL non trovato nel file .env." -ForegroundColor Red
    }
} else {
    Write-Host "⚠️ File .env non trovato nella cartella." -ForegroundColor Red
}

# 2. Setup (opzionale) GitHub MCP
Write-Host ""
$addGithub = Read-Host "Vuoi configurare anche il MCP di GitHub per aprire Pull Request? (S/N)"
if ($addGithub -match "^[sS]") {
    Write-Host "Configurazione del server MCP GitHub (ATTENZIONE: richiedera' un token GitHub se non settato a livello globale)..." -ForegroundColor Yellow
    try {
        claude mcp add github npx -y @modelcontextprotocol/server-github
        Write-Host "✅ GitHub MCP installato correttamente!" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ Errore nell'aggiunta del MCP GitHub." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Setup Completato! Puoi avviare una sessione scrivendo semplicemente: claude" -ForegroundColor Cyan
