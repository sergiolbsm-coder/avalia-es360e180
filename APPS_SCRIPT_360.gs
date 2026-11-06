/**
 * Apps Script dedicado à "Avaliação 360°/180° IDL" (360.html, 360-admin.html, 360-portal.html).
 * Isolado dos demais scripts do idl-sistema (planilha e implantação próprias).
 *
 * MODELO DE ACESSO
 *  - Respondente: precisa de um TOKEN (código tipo ABCD-EFGH). Cada token vale para UMA pessoa avaliada e UM grupo
 *    de avaliadores (autoavaliação, gestor, pares, equipe, outros). O token define empresa, ciclo, formato (360/180),
 *    pessoa avaliada e grupo NO SERVIDOR; o navegador não consegue trocar esses dados.
 *    Autoavaliação e gestor: token individual (1 uso). Pares/equipe/outros: token coletivo (N usos, um link por grupo).
 *  - Empresa: login (empresa + senha) em 360-portal.html. Vê SÓ a participação (quem já respondeu, quantos faltam)
 *    e os links de convite. NUNCA recebe respostas nem relatórios: quem entrega o relatório é o IDL.
 *  - Admin (IDL): ADMIN_SECRET, guardado nas Propriedades do script. Sem ele definido, tudo que exige admin
 *    fica bloqueado (fail-closed).
 *
 * ANONIMATO
 *  - O token NÃO é gravado na resposta e a data é gravada sem hora: não há como ligar token a resposta.
 *  - A regra de mínimo de respondentes por grupo (padrão 3) é aplicada na geração do relatório (360-core.js),
 *    que só roda no painel do IDL. O portal da empresa não recebe nenhuma resposta.
 *  - Limite conhecido: o IDL (admin) enxerga as respostas brutas, inclusive a ordem de gravação na planilha.
 *    Quem tiver acesso à planilha também. Restrinja o compartilhamento da planilha.
 *
 * COMO IMPLANTAR (só o dono da conta consegue):
 *   1. Crie uma planilha "IDL — 360 — Respostas" e abra Extensões → Apps Script.
 *   2. Cole este arquivo em Code.gs.
 *   3. Configurações do projeto → Propriedades do script → adicione ADMIN_SECRET com um valor forte.
 *   4. Implantar → Nova implantação → App da Web. Executar como: Eu. Acesso: Qualquer pessoa.
 *   5. Copie a URL /exec e cole em API_360 no arquivo 360-api.js.
 *   Para atualizar depois: Implantar → Gerenciar implantações → lápis → Nova versão
 *   (nunca "Nova implantação", que gera URL nova e deixa a antiga órfã).
 *
 * REGRA DO PROJETO: coluna nova só no FINAL dos cabeçalhos, nunca no meio.
 */

var ABA_RESPOSTAS = 'Respostas';
var ABA_TOKENS = 'Tokens';
var ABA_EMPRESAS = 'Empresas';
var CAB_RESPOSTAS = ['data', 'empresa', 'ciclo', 'modo', 'avaliado_id', 'avaliado_nome', 'grupo', 'config_versao', 'respostas_json', 'abertas_json'];
var CAB_TOKENS = ['codigo', 'empresa', 'ciclo', 'modo', 'avaliado_id', 'avaliado_nome', 'grupo', 'limite', 'usos', 'gerado_em', 'ultimo_uso', 'cargo'];
var CAB_EMPRESAS = ['empresa', 'senha_hash', 'definido_em'];

var GRUPOS_POR_MODO = { '360': ['self', 'gestor', 'pares', 'liderados', 'outros'], '180': ['self', 'gestor'] };
var GRUPOS_ANONIMOS = { pares: true, liderados: true, outros: true };
var LIMITE_PADRAO = { pares: 4, liderados: 5, outros: 3 };
var ESCALA_MIN = 1;
var ESCALA_MAX = 5;
var MAX_ITENS = 80;
var MAX_TEXTO = 2000;
var MAX_CAMPO = 20000;

// ── utilidades ──────────────────────────────────────────────────────────────
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function erro_(msg) { return { status: 'erro', mensagem: msg }; }
function adminOk_(secret) {
  var a = PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET') || '';
  return !!a && secret === a;
}
function norm_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function hoje_() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'); }
function slug_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function rand_(n) {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
  for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function aba_(nome, cab) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nome);
  if (!sh) {
    // Reaproveita a primeira aba vazia para "Respostas"; as demais são criadas.
    var primeira = ss.getSheets()[0];
    if (nome === ABA_RESPOSTAS && primeira.getLastRow() === 0 && primeira.getSheetName() !== ABA_TOKENS && primeira.getSheetName() !== ABA_EMPRESAS) {
      sh = primeira; sh.setName(nome);
    } else {
      sh = ss.insertSheet(nome);
    }
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(cab);
    sh.setFrozenRows(1);
  }
  return sh;
}

function tabela_(nome, cab) {
  var sh = aba_(nome, cab);
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  var h = v[0];
  return v.slice(1).map(function (row, i) {
    var o = { _row: i + 2 };
    h.forEach(function (c, j) { o[c] = row[j]; });
    return o;
  });
}
function limpa_(o) { delete o._row; return o; }

function hashSenha_(empresa, senha) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, norm_(empresa) + ':' + String(senha));
  return bytes.map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length < 2 ? '0' + x : x; }).join('');
}

// ── tokens ──────────────────────────────────────────────────────────────────
function codigo_() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s.slice(0, 4) + '-' + s.slice(4);
}

function acharToken_(codigo) {
  var n = String(codigo || '').trim().toUpperCase();
  if (!n) return null;
  var t = tabela_(ABA_TOKENS, CAB_TOKENS);
  for (var i = 0; i < t.length; i++) {
    if (String(t[i].codigo).trim().toUpperCase() === n) return t[i];
  }
  return null;
}

function doCheckToken_(codigo) {
  var t = acharToken_(codigo);
  if (!t) return { status: 'ok', valido: false, mensagem: 'Código não encontrado' };
  if (Number(t.usos) >= Number(t.limite)) return { status: 'ok', valido: false, mensagem: 'Este link já foi utilizado' };
  return {
    status: 'ok', valido: true, empresa: t.empresa, ciclo: t.ciclo, modo: t.modo,
    avaliado_id: t.avaliado_id, avaliado_nome: t.avaliado_nome, grupo: t.grupo
  };
}

// Cria os tokens de uma pessoa avaliada (um por grupo do formato). Idempotente: grupo que já tem token reaproveita o código.
function doGerarConvites_(d) {
  if (!adminOk_(d.secret)) return erro_('Não autorizado');
  var empresa = String(d.empresa || '').trim(), ciclo = String(d.ciclo || '').trim(), nome = String(d.avaliado_nome || '').trim();
  var cargo = String(d.cargo || '').trim().slice(0, 120), modo = String(d.modo);
  if (!empresa || empresa.length > 120) return erro_('Informe a empresa');
  if (!ciclo || ciclo.length > 80) return erro_('Informe o ciclo');
  if (!nome || nome.length > 120) return erro_('Informe o nome da pessoa avaliada');
  if (!GRUPOS_POR_MODO[modo]) return erro_('Formato inválido (use 360 ou 180)');
  var id = String(d.avaliado_id || '');
  if (id && !/^[a-z0-9-]{3,60}$/.test(id)) return erro_('Identificador inválido');
  if (!id) id = slug_(nome) + '-' + rand_(4);
  var limites = d.limites || {};

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = aba_(ABA_TOKENS, CAB_TOKENS);
    var tab = tabela_(ABA_TOKENS, CAB_TOKENS), usados = {};
    tab.forEach(function (t) { usados[String(t.codigo).toUpperCase()] = true; });
    var agora = hoje_(), rows = [], saida = [];
    GRUPOS_POR_MODO[modo].forEach(function (g) {
      var ex = null;
      tab.forEach(function (t) {
        if (norm_(t.empresa) === norm_(empresa) && norm_(t.ciclo) === norm_(ciclo) && t.avaliado_id === id && t.grupo === g) ex = t;
      });
      if (ex) { saida.push({ grupo: g, codigo: ex.codigo, limite: Number(ex.limite), novo: false }); return; }
      var lim = 1;
      if (GRUPOS_ANONIMOS[g]) {
        lim = Number(limites[g] != null ? limites[g] : LIMITE_PADRAO[g]);
        if (!(lim >= 1 && lim <= 500)) lim = LIMITE_PADRAO[g];
        lim = Math.floor(lim);
      }
      var c;
      do { c = codigo_(); } while (usados[c]);
      usados[c] = true;
      rows.push([c, empresa, ciclo, modo, id, nome, g, lim, 0, agora, '', cargo]);
      saida.push({ grupo: g, codigo: c, limite: lim, novo: true });
    });
    if (rows.length) {
      var ini = sh.getLastRow() + 1;
      sh.getRange(ini, 1, rows.length, CAB_TOKENS.length).setValues(rows);
      sh.getRange(ini, 1, rows.length, 1).setNumberFormat('@');
    }
    return { status: 'ok', avaliado_id: id, tokens: saida };
  } finally {
    lock.releaseLock();
  }
}

// Aumenta (ou reduz, sem ficar abaixo dos usos) o limite de um token coletivo
function doAjustarLimite_(d) {
  if (!adminOk_(d.secret)) return erro_('Não autorizado');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var t = acharToken_(d.codigo);
    if (!t) return erro_('Código não encontrado');
    if (!GRUPOS_ANONIMOS[t.grupo]) return erro_('Só grupos coletivos têm limite ajustável');
    var lim = Math.floor(Number(d.limite));
    if (!(lim >= 1 && lim <= 500)) return erro_('Limite entre 1 e 500');
    if (lim < Number(t.usos)) return erro_('O limite não pode ficar abaixo dos usos já feitos (' + t.usos + ')');
    aba_(ABA_TOKENS, CAB_TOKENS).getRange(t._row, CAB_TOKENS.indexOf('limite') + 1).setValue(lim);
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

// ── gravação de resposta (consome o token dentro de um lock) ────────────────
function validarRespostas_(txt) {
  if (txt == null || String(txt).length > MAX_CAMPO) return null;
  var o;
  try { o = JSON.parse(txt); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  var ks = Object.keys(o);
  if (!ks.length || ks.length > MAX_ITENS) return null;
  var out = {};
  for (var i = 0; i < ks.length; i++) {
    var k = ks[i], v = o[k];
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) return null;
    if (v === null) { out[k] = null; continue; }
    if (typeof v !== 'number' || v !== Math.floor(v) || v < ESCALA_MIN || v > ESCALA_MAX) return null;
    out[k] = v;
  }
  return out;
}
function validarAbertas_(txt) {
  if (txt == null || txt === '') return {};
  if (String(txt).length > MAX_CAMPO) return null;
  var o;
  try { o = JSON.parse(txt); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  var ks = Object.keys(o);
  if (ks.length > 10) return null;
  var out = {};
  for (var i = 0; i < ks.length; i++) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(ks[i]) || typeof o[ks[i]] !== 'string') return null;
    var s = o[ks[i]].trim();
    if (s) out[ks[i]] = s.slice(0, MAX_TEXTO);
  }
  return out;
}

function doSalvar_(d) {
  var resp = validarRespostas_(d.respostas_json);
  if (!resp) return erro_('Formato de respostas inválido');
  var ab = validarAbertas_(d.abertas_json);
  if (!ab) return erro_('Formato de comentários inválido');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var t = acharToken_(d.token);
    if (!t) return erro_('Código inválido');
    if (Number(t.usos) >= Number(t.limite)) return erro_('Este link já foi utilizado');
    // Empresa, ciclo, formato, pessoa avaliada e grupo vêm do TOKEN; o token em si não é gravado (anonimato).
    var linha = [hoje_(), t.empresa, t.ciclo, t.modo, t.avaliado_id, t.avaliado_nome, t.grupo,
      String(d.config_versao || '').slice(0, 20), JSON.stringify(resp), JSON.stringify(ab)];
    aba_(ABA_RESPOSTAS, CAB_RESPOSTAS).appendRow(linha);
    var sh = aba_(ABA_TOKENS, CAB_TOKENS);
    sh.getRange(t._row, CAB_TOKENS.indexOf('usos') + 1).setValue(Number(t.usos) + 1);
    sh.getRange(t._row, CAB_TOKENS.indexOf('ultimo_uso') + 1).setValue(hoje_());
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

// ── empresas (portal) ───────────────────────────────────────────────────────
function doDefinirSenha_(d) {
  if (!adminOk_(d.secret)) return erro_('Não autorizado');
  if (!d.empresa || !d.senha || String(d.senha).length < 6) return erro_('Informe empresa e senha com ao menos 6 caracteres');
  var sh = aba_(ABA_EMPRESAS, CAB_EMPRESAS);
  var hash = hashSenha_(d.empresa, d.senha);
  var t = tabela_(ABA_EMPRESAS, CAB_EMPRESAS), achou = null;
  for (var i = 0; i < t.length; i++) if (norm_(t[i].empresa) === norm_(d.empresa)) achou = t[i];
  if (achou) { sh.getRange(achou._row, 2).setValue(hash); sh.getRange(achou._row, 3).setValue(hoje_()); }
  else sh.appendRow([String(d.empresa).trim(), hash, hoje_()]);
  return { status: 'ok' };
}

function tentativasEmpresa_(empresa, falhou) {
  var cache = CacheService.getScriptCache(), k = '360_tent_' + norm_(empresa);
  var n = Number(cache.get(k) || 0);
  if (falhou) { n++; cache.put(k, String(n), 900); }
  return n;
}

function loginEmpresa_(empresa, senha) {
  if (tentativasEmpresa_(empresa, false) >= 10) return { ok: false, mensagem: 'Muitas tentativas. Aguarde 15 minutos.' };
  var t = tabela_(ABA_EMPRESAS, CAB_EMPRESAS);
  for (var i = 0; i < t.length; i++) {
    if (norm_(t[i].empresa) === norm_(empresa) && t[i].senha_hash === hashSenha_(empresa, senha)) return { ok: true, empresa: t[i].empresa };
  }
  tentativasEmpresa_(empresa, true);
  return { ok: false, mensagem: 'Empresa ou senha incorretos' };
}

// Portal da empresa: SOMENTE participação e links. Nenhuma resposta, nota ou comentário sai por aqui.
function doPortal_(empresa, senha) {
  var login = loginEmpresa_(empresa, senha);
  if (!login.ok) return { status: 'ok', valido: false, mensagem: login.mensagem };
  var nome = login.empresa, mapa = {}, ordem = [];
  tabela_(ABA_TOKENS, CAB_TOKENS).filter(function (t) { return norm_(t.empresa) === norm_(nome); }).forEach(function (t) {
    var k = t.ciclo + '|' + t.avaliado_id;
    if (!mapa[k]) { mapa[k] = { ciclo: t.ciclo, modo: t.modo, avaliado_nome: t.avaliado_nome, cargo: t.cargo, grupos: [] }; ordem.push(k); }
    mapa[k].grupos.push({ grupo: t.grupo, codigo: t.codigo, limite: Number(t.limite), usos: Number(t.usos) });
  });
  return { status: 'ok', valido: true, empresa: nome, avaliados: ordem.map(function (k) { return mapa[k]; }) };
}

// ── rotas ───────────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    var p = (e && e.parameter) || {}, a = p.action || '';
    if (a === 'checkToken') return json_(doCheckToken_(p.token));
    if (a === 'portalEmpresa') return json_(doPortal_(p.empresa, p.senha));
    if (a === 'validarAdmin') return json_({ status: 'ok', valido: adminOk_(p.secret) });
    if (a === 'getRespostas') {
      if (!adminOk_(p.secret)) return json_(erro_('Não autorizado'));
      return json_({ status: 'ok', respostas: tabela_(ABA_RESPOSTAS, CAB_RESPOSTAS).map(limpa_) });
    }
    if (a === 'getTokens') {
      if (!adminOk_(p.secret)) return json_(erro_('Não autorizado'));
      return json_({ status: 'ok', tokens: tabela_(ABA_TOKENS, CAB_TOKENS).map(limpa_) });
    }
    return json_(erro_('Ação desconhecida'));
  } catch (err) { return json_(erro_(String(err))); }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === 'gerarConvites') return json_(doGerarConvites_(d));
    if (d.action === 'ajustarLimite') return json_(doAjustarLimite_(d));
    if (d.action === 'definirSenhaEmpresa') return json_(doDefinirSenha_(d));
    return json_(doSalvar_(d));
  } catch (err) { return json_(erro_(String(err))); }
}
