$ErrorActionPreference = 'Stop'

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  throw 'Ollama is not installed or is not available in PATH.'
}

Write-Host 'Pulling EmbeddingGemma…' -ForegroundColor Cyan
ollama pull embeddinggemma
Write-Host 'Pulling Qwen3 4B…' -ForegroundColor Cyan
ollama pull qwen3:4b
Write-Host 'Building definitions, embeddings and relationship caches…' -ForegroundColor Cyan
npm run enrich
npm run verify:data
Write-Host 'English Word Studio language intelligence is ready.' -ForegroundColor Green
