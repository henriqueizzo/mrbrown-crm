// =====================================================================
// Mr. Brown CRM — configuração do Supabase
// =====================================================================
// Este arquivo é um script clássico (NÃO é módulo) e deve ser carregado no
// index.html ANTES de js/storage.js.
//
// Onde pegar os valores (painel do Supabase → seu projeto):
//   Project Settings (ícone de engrenagem) → API
//     • "Project URL"          → SUPABASE_URL      (ex.: https://abcdefghijk.supabase.co)
//     • "Project API keys" → "anon" "public" → SUPABASE_ANON_KEY
//
// A anon key é pública por design (vai para o navegador de todo mundo); a
// segurança fica por conta do RLS definido em supabase/schema.sql.
//
// Enquanto os dois valores abaixo começarem com "COLE_AQUI", o app roda em
// MODO LOCAL (dados só neste navegador, via localStorage, sem login).
// Depois de preencher e publicar, o app passa a usar o Supabase (modo online,
// com login por e-mail/senha e sincronização em tempo real).
window.MRBROWN_CONFIG = {
  SUPABASE_URL: "https://pnbvyebkiwusrshavwye.supabase.co",       // ex.: https://xxxx.supabase.co
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuYnZ5ZWJraXd1c3JzaGF2d3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNTU3NDksImV4cCI6MjEwNDczMTc0OX0.hge_mMs4Gv4JFNLTcdnlonaOqDvpijFJyIfZXyekNOE",         // Project Settings → API → anon public
};
