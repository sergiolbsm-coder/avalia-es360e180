/* Avaliação 360°/180° IDL — núcleo de cálculo (compartilhado por 360.html e 360-admin.html).
 * Tudo deriva do JSON 360-config.json: modos, grupos de avaliadores, dimensões, itens, escala e regras de leitura.
 * Registro de avaliação:
 * { id, ciclo, avaliado, avaliadoNome, empresa, modo:'360'|'180', grupo, config_versao, data:'AAAA-MM-DD',
 *   respostas:{itemId: 1..5 | null}, abertas:{continuar,comecar,parar} }
 * Anonimato: grupos anônimos com menos respostas que o mínimo não aparecem sozinhos; os pequenos são somados em
 * "Demais avaliadores" se juntos atingirem o mínimo, senão ficam ocultos e NÃO entram em nenhuma média.
 */
const Core360 = (() => {
  const num = v => typeof v === 'number' && isFinite(v);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const dimsAtivas = cfg => (cfg.dimensoes || []).filter(d => d.ativo !== false);
  const itensAtivos = d => (d.itens || []).filter(i => i.ativo !== false);
  const gruposDoModo = (cfg, modo) => (((cfg.modos || {})[modo] || {}).grupos || []).map(id => Object.assign({ id }, cfg.grupos[id]));
  const minimoAnon = cfg => (cfg.anonimato || {}).minimoGrupo || 3;

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Nota de uma dimensão para uma avaliação: média dos itens respondidos (ignora "não tenho como avaliar")
  function scoreDimResp(dim, resp) {
    return mean(itensAtivos(dim).map(i => resp.respostas && resp.respostas[i.id]).filter(num));
  }

  // Resumo de um conjunto de avaliações (um grupo ou um pool de grupos)
  function resumo(cfg, resps) {
    const dims = dimsAtivas(cfg).map(d => {
      const por = resps.map(r => scoreDimResp(d, r)).filter(x => x != null);
      const itens = itensAtivos(d).map(i => {
        const vs = resps.map(r => r.respostas && r.respostas[i.id]).filter(num);
        return { id: i.id, media: r2(mean(vs)), n: vs.length };
      });
      return { id: d.id, nome: d.nome, media: r2(mean(por)), n: por.length, dp: r2(sd(por)), itens };
    });
    return { n: resps.length, dims, geral: r2(mean(dims.filter(d => d.media != null).map(d => d.media))) };
  }

  function leitura(L, s, r, gap) {
    if (s == null && r == null) return { tipo: 'sem', rotulo: 'Sem dados', cor: '#8B849A' };
    if (r == null) return { tipo: 'so_self', rotulo: 'Só autoavaliação', cor: '#8B849A' };
    if (s != null && gap >= L.limiarGap) return { tipo: 'cego', rotulo: 'Ponto cego', cor: '#D6334A', texto: 'A autoavaliação está acima da percepção dos outros.' };
    if (s != null && gap <= -L.limiarGap) return { tipo: 'escondido', rotulo: 'Força escondida', cor: '#00A79E', texto: 'Os outros veem mais do que a própria pessoa enxerga.' };
    if (r >= L.forte) return { tipo: 'forca', rotulo: 'Força reconhecida', cor: '#1CA355', texto: 'Percepção alta e alinhada.' };
    if (r < L.desenvolver) return { tipo: 'prioridade', rotulo: 'Prioridade de desenvolvimento', cor: '#D69A1E', texto: 'Percepção baixa e alinhada: ponto de partida do PDI.' };
    return { tipo: 'alinhado', rotulo: 'Alinhado', cor: '#391694', texto: 'Autoavaliação e percepção dos outros próximas.' };
  }

  // Análise completa de um avaliado: recebe todas as avaliações dele (já filtradas por ciclo e avaliado)
  function analisar(cfg, modo, avals) {
    const L = cfg.leitura, minA = minimoAnon(cfg);
    const gs = gruposDoModo(cfg, modo);
    const contagem = {};
    const exibidos = [], pequenos = [];
    gs.forEach(g => {
      const rs = avals.filter(a => a.grupo === g.id);
      contagem[g.id] = rs.length;
      if (!rs.length) return;
      if (!g.anonimo) { exibidos.push({ id: g.id, rotulo: g.rotulo, cor: g.cor, anonimo: false, resps: rs }); return; }
      if (rs.length >= (g.minimo || minA)) exibidos.push({ id: g.id, rotulo: g.rotulo, cor: g.cor, anonimo: true, resps: rs });
      else pequenos.push({ g, rs });
    });
    // grupos anônimos pequenos: somados se juntos atingirem o mínimo; senão ocultos (não entram em nada)
    const poolPeq = pequenos.flatMap(p => p.rs);
    const ocultos = [];
    if (poolPeq.length && poolPeq.length >= minA) {
      exibidos.push({ id: 'consolidado', rotulo: 'Demais avaliadores', cor: '#8B849A', anonimo: true, resps: poolPeq, composicao: pequenos.map(p => p.g.rotulo) });
    } else pequenos.forEach(p => ocultos.push({ id: p.g.id, rotulo: p.g.rotulo, n: p.rs.length, minimo: p.g.minimo || minA }));

    exibidos.forEach(e => { e.res = resumo(cfg, e.resps); });
    const self = exibidos.find(e => e.id === 'self');
    const gestor = exibidos.find(e => e.id === 'gestor');
    const anon = exibidos.filter(e => e.anonimo);
    const poolAnon = anon.flatMap(e => e.resps);

    // Referência = "o olhar dos outros". 360: avaliadores anônimos somados (sem o gestor, que aparece à parte).
    // 180 (ou 360 sem grupo anônimo exibível): o gestor.
    let ref = null;
    if (modo === '360' && poolAnon.length) ref = { id: 'avaliadores', rotulo: 'Visão dos avaliadores', n: poolAnon.length, composicao: anon.map(a => a.rotulo), resps: poolAnon };
    else if (gestor) ref = { id: 'gestor', rotulo: gestor.rotulo, n: gestor.resps.length, composicao: [gestor.rotulo], resps: gestor.resps };
    const refRes = ref ? resumo(cfg, ref.resps) : null;
    const selfRes = self ? self.res : null;

    const dims = dimsAtivas(cfg);
    const linhas = dims.map((d, idx) => {
      const s = selfRes ? selfRes.dims[idx].media : null;
      const rd = refRes ? refRes.dims[idx] : null;
      const r = rd ? rd.media : null;
      const gap = (s != null && r != null) ? r2(s - r) : null;
      return {
        id: d.id, nome: d.nome, descricao: d.descricao, self: s, ref: r, gap, dp: rd ? rd.dp : null,
        divergente: !!(rd && rd.dp != null && rd.dp >= L.divergenciaDP),
        grupos: exibidos.map(e => ({ id: e.id, media: e.res.dims[idx].media, n: e.res.dims[idx].n })),
        leitura: leitura(L, s, r, gap)
      };
    });

    const itens = [];
    dims.forEach((d, idx) => itensAtivos(d).forEach(it => {
      const si = selfRes && selfRes.dims[idx].itens.find(x => x.id === it.id);
      const ri = refRes && refRes.dims[idx].itens.find(x => x.id === it.id);
      const s = si ? si.media : null, r = ri ? ri.media : null;
      itens.push({ id: it.id, dim: d.nome, dimId: d.id, texto: cap(it.ele), self: s, ref: r, gap: (s != null && r != null) ? r2(s - r) : null });
    }));
    const comRef = itens.filter(i => i.ref != null);
    const forcas = [...comRef].sort((a, b) => b.ref - a.ref).slice(0, 3);
    const oportunidades = [...comRef].sort((a, b) => a.ref - b.ref).slice(0, 3);
    const cegos = itens.filter(i => i.gap != null && i.gap >= L.limiarGap).sort((a, b) => b.gap - a.gap).slice(0, 3);
    const escondidos = itens.filter(i => i.gap != null && i.gap <= -L.limiarGap).sort((a, b) => a.gap - b.gap).slice(0, 3);

    // Comentários: só de grupos exibidos; anônimos sem identificação e embaralhados
    const abertas = (cfg.abertas || []).map(a => ({ id: a.id, rotulo: a.rotulo, itens: [] }));
    exibidos.forEach(e => e.resps.forEach(r => (cfg.abertas || []).forEach((a, k) => {
      const t = ((r.abertas && r.abertas[a.id]) || '').trim();
      if (t) abertas[k].itens.push({ de: e.anonimo ? 'Avaliador anônimo' : e.rotulo, texto: t });
    })));
    abertas.forEach(a => shuffle(a.itens));

    const geralSelf = selfRes ? selfRes.geral : null, geralRef = refRes ? refRes.geral : null;
    return {
      modo, contagem, ocultos,
      grupos: exibidos.map(e => ({ id: e.id, rotulo: e.rotulo, cor: e.cor, anonimo: e.anonimo, n: e.resps.length, composicao: e.composicao || null, geral: e.res.geral })),
      ref: ref ? { id: ref.id, rotulo: ref.rotulo, n: ref.n, composicao: ref.composicao } : null,
      geral: { self: geralSelf, ref: geralRef, gap: (geralSelf != null && geralRef != null) ? r2(geralSelf - geralRef) : null },
      linhas, itens, forcas, oportunidades, cegos, escondidos, abertas,
      resumoLeitura: {
        cegos: linhas.filter(l => l.leitura.tipo === 'cego').length,
        escondidos: linhas.filter(l => l.leitura.tipo === 'escondido').length,
        forcas: linhas.filter(l => l.leitura.tipo === 'forca').length,
        prioridades: linhas.filter(l => l.leitura.tipo === 'prioridade').length,
        divergentes: linhas.filter(l => l.divergente).length
      }
    };
  }

  function validarConfig(cfg) {
    const e = [];
    const esc = cfg.escala || {};
    if (!esc.rotulos || esc.rotulos.length !== (esc.max - esc.min + 1)) e.push('A escala precisa ter um rótulo para cada valor entre min e max.');
    Object.keys(cfg.modos || {}).forEach(m => (cfg.modos[m].grupos || []).forEach(g => { if (!cfg.grupos[g]) e.push('Modo ' + m + ' usa o grupo inexistente "' + g + '".'); }));
    const ids = new Set();
    (cfg.dimensoes || []).forEach(d => {
      if (!itensAtivos(d).length && d.ativo !== false) e.push('A dimensão "' + d.nome + '" não tem itens ativos.');
      (d.itens || []).forEach(i => {
        if (ids.has(i.id)) e.push('ID de item repetido: ' + i.id);
        ids.add(i.id);
        if (!i.ele || !i.eu) e.push('O item ' + i.id + ' precisa das duas redações (ele/ela e eu).');
      });
    });
    return e;
  }

  const AB_DEMO = {
    continuar: ['Manter as conversas 1:1, elas fazem diferença.', 'Continuar sendo acessível quando surge um problema.', 'Seguir explicando o porquê das decisões.', 'Os elogios em reunião motivam muito a equipe.'],
    comecar: ['Delegar mais e confiar mais na entrega dos outros.', 'Compartilhar mais cedo as mudanças que vêm da diretoria.', 'Dar feedback corretivo no momento, não só no ciclo.'],
    parar: ['Interromper quando já tem uma opinião formada.', 'Mudar prioridades no meio da semana sem avisar.', 'Resolver sozinho o que a equipe poderia decidir.']
  };

  // Dados fictícios para teste (grupos com tamanhos típicos; viés próprio por dimensão)
  function demo(cfg, modo, ciclo, avaliadoId, avaliadoNome, empresa, qtd) {
    const dims = dimsAtivas(cfg);
    const esp = Object.assign({ self: 1, gestor: 1, pares: 4, liderados: 5, outros: 3 }, qtd || {});
    const base = {}, vies = {};
    dims.forEach(d => { base[d.id] = 2.4 + Math.random() * 2.1; vies[d.id] = (Math.random() - 0.4) * 1.5; });
    const clamp = v => Math.max(1, Math.min(5, Math.round(v)));
    const hoje = new Date().toISOString().slice(0, 10);
    const out = [];
    gruposDoModo(cfg, modo).forEach(g => {
      for (let k = 0; k < (esp[g.id] || 0); k++) {
        const respostas = {};
        dims.forEach(d => itensAtivos(d).forEach(i => {
          if (g.id !== 'self' && Math.random() < 0.03) { respostas[i.id] = null; return; }
          const ajuste = g.id === 'self' ? vies[d.id] : (g.id === 'gestor' ? (Math.random() - 0.5) * 0.5 : 0);
          respostas[i.id] = clamp(base[d.id] + ajuste + (Math.random() - 0.5) * 1.8);
        }));
        const abertas = {};
        Object.keys(AB_DEMO).forEach(k2 => { if (Math.random() < 0.7) abertas[k2] = AB_DEMO[k2][Math.floor(Math.random() * AB_DEMO[k2].length)]; });
        out.push({ id: 'd' + Math.random().toString(36).slice(2, 9), ciclo, avaliado: avaliadoId, avaliadoNome, empresa, modo, grupo: g.id, config_versao: cfg.versao, data: hoje, respostas, abertas });
      }
    });
    return out;
  }

  // Armazenamento local (modo teste). Quando houver backend, trocar só este bloco.
  const store = {
    chave: 'idl360_avaliacoes',
    listar() { try { return JSON.parse(localStorage.getItem(this.chave) || '[]'); } catch (e) { return []; } },
    salvar(lista) { try { localStorage.setItem(this.chave, JSON.stringify(lista)); return true; } catch (e) { return false; } },
    add(rec) { const l = this.listar(); l.push(rec); return this.salvar(l); }
  };

  return { dimsAtivas, itensAtivos, gruposDoModo, minimoAnon, resumo, analisar, leitura, validarConfig, demo, cap, store };
})();
