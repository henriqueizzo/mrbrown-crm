/* =====================================================================
 * Mr. Brown CRM — camada de dados (window.MrBrownStorage)
 * =====================================================================
 * Script clássico (não módulo). Ordem de carregamento no index.html:
 *   1. config.js                          → window.MRBROWN_CONFIG
 *   2. supabase-js (UMD, via CDN)         → window.supabase   (opcional)
 *   3. js/storage.js (este arquivo)       → window.MrBrownStorage
 *
 * Dois backends internos, escolhidos em init():
 *   - "local"    : localStorage (chave mrbrown-crm-v3). Usado quando config.js
 *                  ainda tem os placeholders ou quando supabase-js não carregou.
 *   - "supabase" : Postgres + Auth + Realtime do Supabase.
 *
 * Contrato completo em docs/ARQUITETURA.md. Todos os métodos são async e
 * rejeitam com Error cuja message já está em português (pronta para toast).
 * ===================================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------
  const CHAVE_V3 = "mrbrown-crm-v3";
  const CHAVE_V2 = "mrbrown-crm-v2";
  const TABELAS_REALTIME = ["contatos", "produtos", "pedidos", "pedido_itens", "usuarios"];
  const STATUS_CONTATO = ["novo", "conversa", "degustacao", "proposta", "fechado", "perdido"];
  const STATUS_PEDIDO = ["orcamento", "confirmado", "producao", "pronto", "entregue", "cancelado"];
  const PAPEIS = ["admin", "vendedor"];
  const DEBOUNCE_MS = 300;

  const MSG_NAO_CADASTRADO = "E-mail não cadastrado. Peça para um administrador incluir você na aba Usuários.";
  const MSG_DESATIVADO = "Seu acesso está desativado.";
  const MSG_SEM_REDE = "Sem conexão com o servidor. Verifique sua internet e tente de novo.";

  const USUARIO_LOCAL = Object.freeze({ id: "local", nome: "Uso local", email: "", papel: "admin", ativo: true });

  function produtosDoSite() {
    return [
      { id: "site-tradicional", nome: "Tradicional",          categoria: "Cookie tradicional", selo: "Carro-chefe",       preco: null, descricao: "Massa amanteigada no ponto certo com gotas de chocolate. O queridinho da casa.", ativo: true, do_site: true },
      { id: "site-nutella",     nome: "Nutella",              categoria: "Cookie recheado",    selo: "Mais pedido",       preco: null, descricao: "Cookie recheado com Nutella cremosa no centro. Servido morno, é puro conforto.", ativo: true, do_site: true },
      { id: "site-ovomaltine",  nome: "Ovomaltine",           categoria: "Cookie recheado",    selo: "",                  preco: null, descricao: "Recheio cremoso de Ovomaltine com aqueles flocos crocantes. Pura nostalgia.", ativo: true, do_site: true },
      { id: "site-chocolatudo", nome: "Chocolatudo",          categoria: "Cookie recheado",    selo: "",                  preco: null, descricao: "Para os chocólatras: massa de chocolate com recheio de chocolate que escorre.", ativo: true, do_site: true },
      { id: "site-limao",       nome: "Limão Siciliano",      categoria: "Cookie recheado",    selo: "",                  preco: null, descricao: "Recheio cremoso de limão siciliano. Doçura na medida com um toque cítrico refrescante.", ativo: true, do_site: true },
      { id: "site-pistache",    nome: "Pistache",             categoria: "Cookie recheado",    selo: "Especial",          preco: null, descricao: "Recheio cremoso de pistache de verdade. Sofisticado e viciante.", ativo: true, do_site: true },
      { id: "site-mini",        nome: "Mini Cookie Recheado", categoria: "Mini cookies",       selo: "Para compartilhar", preco: null, descricao: "Caixinha de mini cookies recheados para mergulhar na cobertura de chocolate. Perfeitos para compartilhar (ou não!).", ativo: true, do_site: true },
    ];
  }

  // Mesmos ids fixos do seed em supabase/schema.sql.
  function usuariosIniciais() {
    return [
      { id: "00000000-0000-4000-8000-000000000001", auth_id: null, nome: "Henrique Izzo",            email: "henriqueia1923@gmail.com", papel: "admin",    ativo: true },
      { id: "00000000-0000-4000-8000-000000000002", auth_id: null, nome: "Daniela Guastella Izzo",   email: "",                         papel: "admin",    ativo: true },
      { id: "00000000-0000-4000-8000-000000000003", auth_id: null, nome: "Guilherme Guastella Izzo", email: "",                         papel: "vendedor", ativo: true },
    ];
  }

  // ---------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------
  function uuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }
  function clonar(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
  function erro(msg) { const e = new Error(msg); e.traduzido = true; return e; }
  function texto(v) { return String(v == null ? "" : v).trim(); }
  function numero(v, padrao) { const n = Number(v); return Number.isFinite(n) ? n : padrao; }
  function precoOuNulo(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  function dataIso(v) { const s = texto(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
  function hojeIso() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function emailLimpo(v) { return texto(v).toLowerCase(); }
  function emailValido(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  // Normalização dos registros (garante o formato do contrato e valida o mínimo).
  function normContato(c) {
    c = c || {};
    const nome = texto(c.nome);
    if (!nome) throw erro("Informe o nome do contato.");
    return {
      id: texto(c.id) || uuid(),
      nome,
      empresa: texto(c.empresa),
      data: dataIso(c.data) || hojeIso(),
      status: STATUS_CONTATO.includes(c.status) ? c.status : "novo",
      objetivo: texto(c.objetivo),
    };
  }
  function normProduto(p) {
    p = p || {};
    const nome = texto(p.nome);
    if (!nome) throw erro("Informe o nome do produto.");
    return {
      id: texto(p.id) || uuid(),
      nome,
      categoria: texto(p.categoria),
      selo: texto(p.selo),
      preco: precoOuNulo(p.preco),
      descricao: texto(p.descricao),
      ativo: p.ativo !== false,
      do_site: !!(p.do_site !== undefined ? p.do_site : p.doSite),
    };
  }
  function normPedido(p) {
    p = p || {};
    const contato_id = texto(p.contato_id !== undefined ? p.contato_id : p.contatoId);
    if (!contato_id) throw erro("Escolha o contato do pedido.");
    const itens = (Array.isArray(p.itens) ? p.itens : [])
      .map((i) => ({
        produto_id: texto(i.produto_id !== undefined ? i.produto_id : i.produtoId),
        qtd: numero(i.qtd, 0),
        preco: numero(i.preco, 0),
      }))
      .filter((i) => i.produto_id);
    const numeroPedido = p.numero === null || p.numero === undefined || p.numero === "" ? null : numero(p.numero, null);
    return {
      id: texto(p.id) || uuid(),
      numero: numeroPedido,
      contato_id,
      data: dataIso(p.data) || hojeIso(),
      entrega: dataIso(p.entrega),
      status: STATUS_PEDIDO.includes(p.status) ? p.status : "orcamento",
      obs: texto(p.obs),
      itens,
    };
  }
  function normUsuario(u) {
    u = u || {};
    const nome = texto(u.nome);
    if (!nome) throw erro("Informe o nome do usuário.");
    const email = emailLimpo(u.email);
    if (email && !emailValido(email)) throw erro("E-mail inválido.");
    return {
      id: texto(u.id) || uuid(),
      auth_id: u.auth_id || null,
      nome,
      email,
      papel: PAPEIS.includes(u.papel) ? u.papel : "vendedor",
      ativo: u.ativo !== false,
    };
  }

  // ---------------------------------------------------------------------
  // Emissor compartilhado (callbacks de onAuth / onChange)
  // ---------------------------------------------------------------------
  const emissor = {
    cbsAuth: [],
    cbsChange: [],
    timerChange: null,
    emitirAuth(usuario, evento) {
      for (const cb of this.cbsAuth) {
        try { cb(usuario ? clonar(usuario) : null, evento); } catch (e) { console.error("[MrBrownStorage] erro em onAuth:", e); }
      }
    },
    agendarChange() {
      clearTimeout(this.timerChange);
      this.timerChange = setTimeout(() => {
        for (const cb of this.cbsChange) {
          try { cb(); } catch (e) { console.error("[MrBrownStorage] erro em onChange:", e); }
        }
      }, DEBOUNCE_MS);
    },
  };

  // =====================================================================
  // BACKEND LOCAL (localStorage)
  // =====================================================================
  const local = (function () {
    let dados = null;
    let usuario = null;
    let ouvindoStorage = false;

    function ler() {
      try {
        const bruto = localStorage.getItem(CHAVE_V3);
        if (!bruto) return null;
        const d = JSON.parse(bruto);
        if (!d || !Array.isArray(d.contatos)) return null;
        return completar(d);
      } catch (e) { return null; }
    }

    function completar(d) {
      d.contatos = Array.isArray(d.contatos) ? d.contatos : [];
      d.produtos = Array.isArray(d.produtos) ? d.produtos : [];
      d.pedidos = Array.isArray(d.pedidos) ? d.pedidos : [];
      d.usuarios = Array.isArray(d.usuarios) && d.usuarios.length ? d.usuarios : usuariosIniciais();
      if (!d.produtos.length) d.produtos = produtosDoSite();
      const maior = d.pedidos.reduce((m, p) => Math.max(m, Number(p.numero) || 0), 0);
      if (!Number.isFinite(Number(d.proximo_pedido)) || Number(d.proximo_pedido) <= maior) d.proximo_pedido = maior + 1;
      return d;
    }

    // Migração do formato antigo (mrbrown-crm-v2, camelCase) para o v3 (snake_case).
    function migrarV2() {
      let v2 = null;
      try {
        const bruto = localStorage.getItem(CHAVE_V2);
        if (bruto) v2 = JSON.parse(bruto);
      } catch (e) { v2 = null; }
      if (!v2 || !Array.isArray(v2.contatos)) return null;

      const contatos = v2.contatos.map((c) => {
        const n = {
          id: texto(c.id) || uuid(),
          nome: texto(c.nome) || "(sem nome)",
          empresa: texto(c.empresa),
          data: dataIso(c.data) || hojeIso(),
          status: STATUS_CONTATO.includes(c.status) ? c.status : "novo",
          objetivo: texto(c.objetivo),
        };
        if (c.exemplo) n.exemplo = true;
        return n;
      });

      const produtos = (Array.isArray(v2.produtos) ? v2.produtos : []).map((p) => ({
        id: texto(p.id) || uuid(),
        nome: texto(p.nome) || "(sem nome)",
        categoria: texto(p.categoria),
        selo: texto(p.selo),
        preco: precoOuNulo(p.preco),
        descricao: texto(p.descricao),
        ativo: p.ativo !== false,
        do_site: !!(p.doSite !== undefined ? p.doSite : p.do_site),
      }));
      const idsProdutos = new Set(produtos.map((p) => p.id));
      for (const p of produtosDoSite()) if (!idsProdutos.has(p.id)) produtos.push(p);

      const idsContatos = new Set(contatos.map((c) => c.id));
      let proximo = Math.max(1, Number(v2.proximoPedido) || 1);
      const pedidos = [];
      for (const p of (Array.isArray(v2.pedidos) ? v2.pedidos : [])) {
        const contato_id = texto(p.contatoId !== undefined ? p.contatoId : p.contato_id);
        if (!idsContatos.has(contato_id)) continue; // pedido órfão: descarta
        let num = Number(p.numero);
        if (!Number.isFinite(num) || num <= 0) num = proximo++;
        if (num >= proximo) proximo = num + 1;
        const n = {
          id: texto(p.id) || uuid(),
          numero: num,
          contato_id,
          data: dataIso(p.data) || hojeIso(),
          entrega: dataIso(p.entrega),
          status: STATUS_PEDIDO.includes(p.status) ? p.status : "orcamento",
          obs: texto(p.obs),
          itens: (Array.isArray(p.itens) ? p.itens : []).map((i) => ({
            produto_id: texto(i.produtoId !== undefined ? i.produtoId : i.produto_id),
            qtd: numero(i.qtd, 0),
            preco: numero(i.preco, 0),
          })).filter((i) => i.produto_id),
        };
        if (p.exemplo) n.exemplo = true;
        pedidos.push(n);
      }

      console.info("[MrBrownStorage] dados migrados de mrbrown-crm-v2 para mrbrown-crm-v3.");
      return completar({ contatos, produtos, pedidos, usuarios: usuariosIniciais(), proximo_pedido: proximo });
    }

    function semear() {
      return { contatos: [], produtos: produtosDoSite(), pedidos: [], usuarios: usuariosIniciais(), proximo_pedido: 1 };
    }

    function gravar() {
      try { localStorage.setItem(CHAVE_V3, JSON.stringify(dados)); }
      catch (e) { throw erro("Não consegui salvar neste navegador (armazenamento cheio ou bloqueado). Faça um backup."); }
    }

    function garantir() {
      if (!dados) dados = ler() || migrarV2() || semear();
      return dados;
    }

    function ouvirOutrasAbas() {
      if (ouvindoStorage) return;
      ouvindoStorage = true;
      window.addEventListener("storage", (e) => {
        if (e.key !== CHAVE_V3) return;
        dados = ler() || dados;   // outra aba gravou: recarrega o cache
        emissor.agendarChange();
      });
    }

    return {
      modo: "local",

      async init() {
        garantir();
        try { gravar(); } catch (e) { console.warn(e.message); }
        ouvirOutrasAbas();
        return { modo: "local", usuario: null };
      },

      // ---- Autenticação (fictícia) ----
      async login() {
        usuario = Object.assign({}, USUARIO_LOCAL);
        emissor.emitirAuth(usuario);
        return clonar(usuario);
      },
      async logout() {
        usuario = null;
        emissor.emitirAuth(null);
      },
      async primeiroAcesso() { return this.login(); },
      async esqueciSenha() { throw erro("No modo local não existe senha: é só clicar em Entrar."); },
      async novaSenha() { throw erro("No modo local não existe senha."); },
      usuarioAtual() { return usuario ? clonar(usuario) : null; },

      // ---- Dados ----
      async carregarTudo() {
        const d = garantir();
        return {
          contatos: clonar(d.contatos),
          produtos: clonar(d.produtos),
          pedidos: clonar(d.pedidos).sort((a, b) => (b.numero || 0) - (a.numero || 0)),
          usuarios: clonar(d.usuarios),
        };
      },

      async salvarContato(c) {
        const d = garantir();
        const n = normContato(c);
        const i = d.contatos.findIndex((x) => x.id === n.id);
        if (i >= 0) d.contatos[i] = Object.assign({}, d.contatos[i], n); else d.contatos.push(n);
        gravar();
        return clonar(i >= 0 ? d.contatos[i] : n);
      },
      async excluirContato(id) {
        const d = garantir();
        d.contatos = d.contatos.filter((x) => x.id !== id);
        d.pedidos = d.pedidos.filter((p) => p.contato_id !== id);   // cascata
        gravar();
      },

      async salvarProduto(p) {
        const d = garantir();
        const n = normProduto(p);
        const i = d.produtos.findIndex((x) => x.id === n.id);
        if (i >= 0) d.produtos[i] = n; else d.produtos.push(n);
        gravar();
        return clonar(n);
      },
      async excluirProduto(id) {
        const d = garantir();
        const emUso = d.pedidos.some((p) => (p.itens || []).some((i) => i.produto_id === id));
        if (emUso) throw erro("Este produto está em pedidos e não pode ser excluído. Desative-o em vez de excluir.");
        d.produtos = d.produtos.filter((x) => x.id !== id);
        gravar();
      },

      async salvarPedido(p) {
        const d = garantir();
        const n = normPedido(p);
        if (!d.contatos.some((c) => c.id === n.contato_id)) throw erro("O contato deste pedido não existe mais.");
        const i = d.pedidos.findIndex((x) => x.id === n.id);
        if (n.numero === null) n.numero = i >= 0 && d.pedidos[i].numero ? d.pedidos[i].numero : d.proximo_pedido++;
        if (n.numero >= d.proximo_pedido) d.proximo_pedido = n.numero + 1;
        if (i >= 0) d.pedidos[i] = Object.assign({}, d.pedidos[i], n); else d.pedidos.push(n);
        gravar();
        return clonar(i >= 0 ? d.pedidos[i] : n);
      },
      async excluirPedido(id) {
        const d = garantir();
        d.pedidos = d.pedidos.filter((x) => x.id !== id);
        gravar();
      },

      async salvarUsuario(u) {
        const d = garantir();
        const n = normUsuario(u);
        const repetido = n.email && d.usuarios.some((x) => x.id !== n.id && emailLimpo(x.email) === n.email);
        if (repetido) throw erro("Já existe um usuário com esse e-mail.");
        const i = d.usuarios.findIndex((x) => x.id === n.id);
        if (i >= 0) d.usuarios[i] = Object.assign({}, d.usuarios[i], n); else d.usuarios.push(n);
        gravar();
        return clonar(i >= 0 ? d.usuarios[i] : n);
      },
      async excluirUsuario(id) {
        const d = garantir();
        d.usuarios = d.usuarios.filter((x) => x.id !== id);
        gravar();
      },
    };
  })();

  // =====================================================================
  // BACKEND SUPABASE
  // =====================================================================
  const supa = (function () {
    let client = null;
    let usuario = null;          // { id, auth_id, nome, email, papel, ativo }
    let canal = null;            // canal realtime
    const pendentes = {};        // auth_id → Promise(usuario), evita buscas duplicadas
    let recuperandoSenha = false;

    // ---- Tradução de erros -------------------------------------------
    function traduzErro(e) {
      if (e && e.traduzido) return e;
      const msg = String((e && (e.message || e.error_description || e.msg || e.details)) || (typeof e === "string" ? e : "") || "");
      const code = e && (e.code !== undefined ? String(e.code) : (e.status !== undefined ? String(e.status) : ""));
      const m = msg.toLowerCase();
      let pt;

      if (m.includes("não cadastrado")) pt = msg;                                      // mensagem do trigger passa direto
      else if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|econnrefused/.test(m) || (e instanceof TypeError)) pt = MSG_SEM_REDE;
      else if (m.includes("invalid login credentials")) pt = "E-mail ou senha incorretos.";
      else if (m.includes("email not confirmed")) pt = "Confirme seu e-mail antes de entrar.";
      else if (m.includes("database error saving new user") || m.includes("database error creating new user") || m.includes("error saving new user")) pt = MSG_NAO_CADASTRADO;
      else if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already exists")) pt = "Este e-mail já tem senha. Use Entrar ou Esqueci minha senha.";
      else if (m.includes("password should be at least") || m.includes("password is too short") || m.includes("weak password") || m.includes("password should contain")) pt = "A senha precisa ter pelo menos 6 caracteres.";
      else if (m.includes("new password should be different")) pt = "A nova senha precisa ser diferente da atual.";
      else if (m.includes("signup requires a valid password") || m.includes("password is required")) pt = "Informe uma senha.";
      else if (m.includes("unable to validate email") || m.includes("invalid format") || m.includes("invalid email")) pt = "E-mail inválido.";
      else if (m.includes("rate limit") || m.includes("for security purposes") || m.includes("too many requests") || code === "429") pt = "Muitas tentativas. Aguarde um minuto e tente de novo.";
      else if (m.includes("signups not allowed") || m.includes("signup is disabled")) pt = "Cadastro de novos acessos está desligado no servidor.";
      else if (m.includes("jwt expired") || m.includes("invalid jwt") || m.includes("refresh token") || m.includes("session_not_found") || m.includes("auth session missing") || code === "401") pt = "Sua sessão expirou. Entre novamente.";
      else if (m.includes("otp_expired") || m.includes("token has expired") || m.includes("link is invalid or has expired") || m.includes("email link is invalid")) pt = "O link expirou ou já foi usado. Peça um novo.";
      else if (code === "42501" || m.includes("row-level security") || m.includes("permission denied")) pt = "Você não tem permissão para fazer isso.";
      else if (code === "23503") pt = m.includes("pedido_itens") ? "Este produto está em pedidos e não pode ser excluído. Desative-o em vez de excluir." : "Este registro depende de outro que não existe mais (ex.: o contato do pedido).";
      else if (code === "23505") pt = m.includes("email") ? "Já existe um usuário com esse e-mail." : "Já existe um registro com esse identificador.";
      else if (code === "23514") pt = "Valor inválido (status, quantidade ou preço fora do permitido).";
      else if (code === "23502") pt = "Um campo obrigatório ficou em branco.";
      else if (code === "22007" || code === "22008") pt = "Data inválida. Use o formato AAAA-MM-DD.";
      else if (code === "22P02") pt = "Valor com formato inválido.";
      else if (code === "PGRST116") pt = "Registro não encontrado.";
      else if (code === "PGRST301" || code === "PGRST302") pt = "Sua sessão expirou. Entre novamente.";
      else if (/^5\d\d$/.test(code)) pt = "O servidor está indisponível no momento. Tente de novo em instantes.";
      else pt = msg ? "Erro no servidor: " + msg : "Erro inesperado. Tente de novo.";

      const err = new Error(pt);
      err.traduzido = true;
      err.original = e;
      return err;
    }

    // Executa uma consulta do supabase-js e devolve só `data`, lançando Error traduzido.
    async function q(consulta) {
      let r;
      try { r = await consulta; } catch (e) { throw traduzErro(e); }
      if (r && r.error) throw traduzErro(r.error);
      return r ? r.data : null;
    }

    // ---- Conversões banco <-> app -------------------------------------
    function contatoDoBanco(r) {
      return { id: r.id, nome: r.nome || "", empresa: r.empresa || "", data: r.data || "", status: r.status, objetivo: r.objetivo || "", criado_em: r.criado_em, atualizado_em: r.atualizado_em };
    }
    function produtoDoBanco(r) {
      return { id: r.id, nome: r.nome || "", categoria: r.categoria || "", selo: r.selo || "", preco: precoOuNulo(r.preco), descricao: r.descricao || "", ativo: r.ativo !== false, do_site: !!r.do_site };
    }
    function itemDoBanco(r) {
      return { id: r.id, pedido_id: r.pedido_id, produto_id: r.produto_id, qtd: numero(r.qtd, 0), preco: numero(r.preco, 0) };
    }
    function pedidoDoBanco(r, itens) {
      return { id: r.id, numero: r.numero == null ? null : Number(r.numero), contato_id: r.contato_id, data: r.data || "", entrega: r.entrega || "", status: r.status, obs: r.obs || "", criado_em: r.criado_em, itens: itens || [] };
    }
    function usuarioDoBanco(r) {
      return { id: r.id, auth_id: r.auth_id || null, nome: r.nome || "", email: r.email || "", papel: r.papel, ativo: r.ativo !== false, criado_em: r.criado_em };
    }

    // ---- Sessão / usuário ---------------------------------------------
    function urlSemHash() { return location.origin + location.pathname + location.search; }

    // Busca a linha de `usuarios` do usuário do Auth. Se não existir ou
    // estiver desativada, encerra a sessão e rejeita.
    function resolverUsuario(authUser) {
      const chave = authUser.id;
      if (pendentes[chave]) return pendentes[chave];
      pendentes[chave] = (async () => {
        let linha = await q(client.from("usuarios").select("*").eq("auth_id", authUser.id).maybeSingle());
        if (!linha && authUser.email) {
          linha = await q(client.from("usuarios").select("*").is("auth_id", null).ilike("email", emailLimpo(authUser.email)).maybeSingle());
        }
        if (!linha) {
          await client.auth.signOut().catch(() => {});
          throw erro(MSG_NAO_CADASTRADO);
        }
        if (linha.ativo === false) {
          await client.auth.signOut().catch(() => {});
          throw erro(MSG_DESATIVADO);
        }
        return usuarioDoBanco(linha);
      })();
      pendentes[chave].finally(() => { delete pendentes[chave]; }).catch(() => {});
      return pendentes[chave];
    }

    // Define o usuário atual e avisa os callbacks de onAuth quando algo mudou.
    function definirUsuario(u, evento) {
      const antes = usuario ? usuario.id : null;
      usuario = u || null;
      if (usuario) iniciarRealtime(); else pararRealtime();
      if ((usuario ? usuario.id : null) !== antes || evento) emissor.emitirAuth(usuario, evento);
    }

    async function tratarEventoAuth(evento, sessao) {
      if (evento === "SIGNED_OUT" || !sessao || !sessao.user) {
        recuperandoSenha = false;
        definirUsuario(null);
        return;
      }
      const ev = evento === "PASSWORD_RECOVERY" ? "recuperacao" : undefined;
      if (ev) recuperandoSenha = true;
      if (usuario && usuario.auth_id === sessao.user.id) {
        if (ev) emissor.emitirAuth(usuario, ev);
        return;
      }
      try {
        const u = await resolverUsuario(sessao.user);
        definirUsuario(u, ev);
      } catch (e) {
        console.warn("[MrBrownStorage] sessão recusada:", e.message);
        definirUsuario(null);
      }
    }

    // ---- Realtime ------------------------------------------------------
    function iniciarRealtime() {
      if (canal || !client) return;
      try {
        canal = client.channel("mrbrown-crm-mudancas");
        for (const tabela of TABELAS_REALTIME) {
          canal.on("postgres_changes", { event: "*", schema: "public", table: tabela }, () => emissor.agendarChange());
        }
        canal.subscribe((status, err) => {
          if (status === "SUBSCRIBED") console.info("[MrBrownStorage] realtime conectado.");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("[MrBrownStorage] realtime:", status, err ? err.message : "");
        });
      } catch (e) {
        console.warn("[MrBrownStorage] não consegui assinar o realtime:", e);
        canal = null;
      }
    }
    function pararRealtime() {
      if (!canal) return;
      try { client.removeChannel(canal); } catch (e) { /* ignora */ }
      canal = null;
    }

    function exigirLogin() {
      if (!usuario) throw erro("Entre com seu e-mail e senha para continuar.");
    }
    function exigirAdmin() {
      exigirLogin();
      if (usuario.papel !== "admin") throw erro("Só administradores podem alterar usuários.");
    }

    return {
      modo: "supabase",
      get recuperandoSenha() { return recuperandoSenha; },

      async init(url, key) {
        client = window.supabase.createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });

        // Não fazer chamadas ao supabase de forma síncrona dentro do callback
        // (recomendação do supabase-js para evitar deadlock): adia com setTimeout.
        client.auth.onAuthStateChange((evento, sessao) => {
          setTimeout(() => { tratarEventoAuth(evento, sessao); }, 0);
        });

        let aviso = null;
        try {
          const dadosSessao = await q(client.auth.getSession());
          const sessao = dadosSessao && dadosSessao.session;
          if (sessao && sessao.user) {
            try { definirUsuario(await resolverUsuario(sessao.user)); }
            catch (e) { aviso = e.message; console.warn("[MrBrownStorage]", aviso); }
          }
        } catch (e) {
          aviso = e.message;
          console.warn("[MrBrownStorage] não consegui recuperar a sessão:", aviso);
        }
        const r = { modo: "supabase", usuario: usuario ? clonar(usuario) : null };
        if (aviso) r.aviso = aviso;
        return r;
      },

      // ---- Autenticação ----
      async login(email, senha) {
        email = emailLimpo(email);
        if (!email) throw erro("Informe seu e-mail.");
        if (!senha) throw erro("Informe sua senha.");
        const dados = await q(client.auth.signInWithPassword({ email, password: senha }));
        const u = await resolverUsuario(dados.user);
        definirUsuario(u);
        return clonar(u);
      },

      async logout() {
        pararRealtime();
        try { await q(client.auth.signOut()); }
        catch (e) { console.warn("[MrBrownStorage] logout:", e.message); }
        definirUsuario(null);
      },

      // Cria a senha de um e-mail já cadastrado em `usuarios` (signUp). O banco
      // recusa e-mails desconhecidos. Resolve com o usuário quando o login é
      // imediato (Confirm email desligado) ou null quando falta confirmar o e-mail.
      async primeiroAcesso(email, senha) {
        email = emailLimpo(email);
        if (!email || !emailValido(email)) throw erro("E-mail inválido.");
        if (!senha || senha.length < 6) throw erro("A senha precisa ter pelo menos 6 caracteres.");
        const dados = await q(client.auth.signUp({ email, password: senha, options: { emailRedirectTo: urlSemHash() } }));
        // Com "Confirm email" ligado, o Supabase responde OK (sem sessão) para um
        // e-mail que já tem conta; nesse caso `identities` vem vazio.
        if (dados && dados.user && Array.isArray(dados.user.identities) && dados.user.identities.length === 0) {
          throw erro("Este e-mail já tem senha. Use Entrar ou Esqueci minha senha.");
        }
        if (dados && dados.session && dados.user) {
          const u = await resolverUsuario(dados.user);
          definirUsuario(u);
          return clonar(u);
        }
        return null; // aguardando confirmação por e-mail
      },

      async esqueciSenha(email) {
        email = emailLimpo(email);
        if (!email || !emailValido(email)) throw erro("E-mail inválido.");
        await q(client.auth.resetPasswordForEmail(email, { redirectTo: urlSemHash() }));
      },

      // Define a nova senha após clicar no link de "esqueci minha senha"
      // (a sessão de recuperação já está ativa nesse momento).
      async novaSenha(senha) {
        if (!senha || senha.length < 6) throw erro("A senha precisa ter pelo menos 6 caracteres.");
        await q(client.auth.updateUser({ password: senha }));
        recuperandoSenha = false;
      },

      usuarioAtual() { return usuario ? clonar(usuario) : null; },

      // ---- Dados ----
      async carregarTudo() {
        exigirLogin();
        const [contatos, produtos, pedidos, itens, usuarios] = await Promise.all([
          q(client.from("contatos").select("*").order("nome", { ascending: true })),
          q(client.from("produtos").select("*").order("nome", { ascending: true })),
          q(client.from("pedidos").select("*").order("numero", { ascending: false })),
          q(client.from("pedido_itens").select("*")),
          q(client.from("usuarios").select("*").order("nome", { ascending: true })),
        ]);
        const itensPorPedido = {};
        for (const i of itens || []) (itensPorPedido[i.pedido_id] = itensPorPedido[i.pedido_id] || []).push(itemDoBanco(i));
        return {
          contatos: (contatos || []).map(contatoDoBanco),
          produtos: (produtos || []).map(produtoDoBanco),
          pedidos: (pedidos || []).map((p) => pedidoDoBanco(p, itensPorPedido[p.id])),
          usuarios: (usuarios || []).map(usuarioDoBanco),
        };
      },

      async salvarContato(c) {
        exigirLogin();
        const n = normContato(c);
        const linha = await q(client.from("contatos").upsert(n, { onConflict: "id" }).select().single());
        return contatoDoBanco(linha);
      },
      async excluirContato(id) {
        exigirLogin();
        await q(client.from("contatos").delete().eq("id", id));   // pedidos caem em cascata
      },

      async salvarProduto(p) {
        exigirLogin();
        const n = normProduto(p);
        const linha = await q(client.from("produtos").upsert(n, { onConflict: "id" }).select().single());
        return produtoDoBanco(linha);
      },
      async excluirProduto(id) {
        exigirLogin();
        await q(client.from("produtos").delete().eq("id", id));    // restrict se estiver em pedidos
      },

      async salvarPedido(p) {
        exigirLogin();
        const n = normPedido(p);
        const linha = { id: n.id, contato_id: n.contato_id, data: n.data, entrega: n.entrega || null, status: n.status, obs: n.obs };
        if (n.numero !== null) linha.numero = n.numero;   // ausente → o banco gera (identity)
        const salvo = await q(client.from("pedidos").upsert(linha, { onConflict: "id" }).select().single());
        await q(client.from("pedido_itens").delete().eq("pedido_id", n.id));
        let itensSalvos = [];
        if (n.itens.length) {
          const novos = n.itens.map((i) => ({ id: uuid(), pedido_id: n.id, produto_id: i.produto_id, qtd: i.qtd, preco: i.preco }));
          itensSalvos = ((await q(client.from("pedido_itens").insert(novos).select())) || []).map(itemDoBanco);
        }
        return pedidoDoBanco(salvo, itensSalvos);
      },
      async excluirPedido(id) {
        exigirLogin();
        await q(client.from("pedidos").delete().eq("id", id));     // itens caem em cascata
      },

      async salvarUsuario(u) {
        exigirAdmin();
        const n = normUsuario(u);
        const linha = { id: n.id, nome: n.nome, email: n.email || null, papel: n.papel, ativo: n.ativo };
        if (usuario && n.id === usuario.id && !n.ativo) throw erro("Você não pode desativar o seu próprio usuário.");
        const salvo = await q(client.from("usuarios").upsert(linha, { onConflict: "id" }).select().single());
        return usuarioDoBanco(salvo);
      },
      async excluirUsuario(id) {
        exigirAdmin();
        if (usuario && id === usuario.id) throw erro("Você não pode excluir o seu próprio usuário.");
        await q(client.from("usuarios").delete().eq("id", id));
      },
    };
  })();

  // =====================================================================
  // FACHADA PÚBLICA — window.MrBrownStorage
  // =====================================================================
  let backend = null;

  function ativo() {
    if (!backend) throw erro("Chame MrBrownStorage.init() antes de usar os dados.");
    return backend;
  }
  function ehPlaceholder(v) { v = texto(v); return !v || v.toUpperCase().startsWith("COLE_AQUI"); }

  const MrBrownStorage = {
    modo: null,                       // "supabase" | "local" (definido após init())

    // Lê config.js e decide o modo. Retorna { modo, usuario } (+ aviso opcional).
    async init() {
      const cfg = window.MRBROWN_CONFIG || {};
      const url = texto(cfg.SUPABASE_URL), key = texto(cfg.SUPABASE_ANON_KEY);
      let resultado;
      if (ehPlaceholder(url) || ehPlaceholder(key)) {
        console.info("[MrBrownStorage] config.js sem URL/chave do Supabase → modo local (localStorage).");
        backend = local;
        resultado = await local.init();
      } else if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.warn("[MrBrownStorage] supabase-js não foi carregado (inclua o script do CDN antes de js/storage.js) → modo local.");
        backend = local;
        resultado = await local.init();
      } else {
        backend = supa;
        resultado = await supa.init(url, key);
      }
      this.modo = backend.modo;
      return resultado;
    },

    // ---- Autenticação ----
    login(email, senha) { return ativo().login(email, senha); },
    logout() { return ativo().logout(); },
    primeiroAcesso(email, senha) { return ativo().primeiroAcesso(email, senha); },
    esqueciSenha(email) { return ativo().esqueciSenha(email); },
    novaSenha(senha) { return ativo().novaSenha(senha); },   // extra: define senha após o link de recuperação
    usuarioAtual() { return backend ? backend.usuarioAtual() : null; },
    get recuperandoSenha() { return backend === supa ? supa.recuperandoSenha : false; },
    onAuth(cb) { if (typeof cb === "function") emissor.cbsAuth.push(cb); },

    // ---- Dados ----
    carregarTudo() { return ativo().carregarTudo(); },
    salvarContato(c) { return ativo().salvarContato(c); },
    excluirContato(id) { return ativo().excluirContato(id); },
    salvarProduto(p) { return ativo().salvarProduto(p); },
    excluirProduto(id) { return ativo().excluirProduto(id); },
    salvarPedido(p) { return ativo().salvarPedido(p); },
    excluirPedido(id) { return ativo().excluirPedido(id); },
    salvarUsuario(u) { return ativo().salvarUsuario(u); },
    excluirUsuario(id) { return ativo().excluirUsuario(id); },
    onChange(cb) { if (typeof cb === "function") emissor.cbsChange.push(cb); },

    // ---- Constantes úteis para a UI ----
    STATUS_CONTATO: STATUS_CONTATO.slice(),
    STATUS_PEDIDO: STATUS_PEDIDO.slice(),
    PAPEIS: PAPEIS.slice(),
  };

  window.MrBrownStorage = MrBrownStorage;
})();
