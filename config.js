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
  SUPABASE_URL: "COLE_AQUI_A_URL_DO_PROJETO",       // ex.: https://xxxx.supabase.co
  SUPABASE_ANON_KEY: "COLE_AQUI_A_ANON_KEY",         // Project Settings → API → anon public
};
