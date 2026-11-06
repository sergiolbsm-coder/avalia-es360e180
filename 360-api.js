/* Acesso ao backend (APPS_SCRIPT_360.gs). Preencha API_360 com a URL /exec depois de implantar.
 * Vazio = modo teste local: sem token, respostas gravadas só no navegador.
 * A URL pode ser sobrescrita pelo navegador (localStorage 'idl360_api_url'), útil para testes e para o painel admin. */
const API_360 = 'https://script.google.com/macros/s/AKfycbyeYE_04AodLiV6Hr3yhqgcsAvYCQZEY7w7DrBMRq27eVWc-wzCuvXgpIxNomZyuNND/exec';

const Api360 = {
  url() {
    if (API_360) return API_360;
    try { return localStorage.getItem('idl360_api_url') || ''; } catch (e) { return ''; }
  },
  ativo() { return !!this.url(); },
  async get(params) {
    const u = this.url();
    const q = new URLSearchParams(params).toString();
    const r = await fetch(u + (u.includes('?') ? '&' : '?') + q + '&_=' + Date.now());
    return r.json();
  },
  async post(body) {
    const r = await fetch(this.url(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return r.json();
  }
};
