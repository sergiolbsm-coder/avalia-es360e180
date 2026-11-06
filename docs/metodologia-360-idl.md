# Avaliação 360° e 180° IDL — metodologia

Arquivos: `360.html` (questionário), `360-admin.html` (ciclos, links e relatório), `360-core.js` (cálculos),
`360-config.json` (toda a parametrização).

## Formatos
| Formato | Quem avalia | Uso |
|---|---|---|
| **360°** | autoavaliação, gestor, pares, equipe (liderados), outros (clientes internos/externos) | produto principal, desenvolvimento de lideranças |
| **180°** | autoavaliação + gestor | porta de entrada, empresas pequenas, sem massa crítica para anonimato |

O 90° (só o gestor) não é oferecido: é o formulário de desempenho que o RH já tem.

## Modelo de competências
Os **8 microcomportamentos de liderança do IDL** (os mesmos do Radar da Liderança do Termômetro de Clima):
Presença, Equidade, Comunicação, Reconhecimento, Escuta, Coerência, Rituais, Clareza.
Cada um tem **3 itens** de comportamento observável (24 no total, cerca de 8 minutos), em escala de frequência 1–5
(Raramente → Consistentemente). Fora da autoavaliação existe a opção “Não tenho como avaliar”, que não conta na média.
Cada item tem duas redações (3ª pessoa para quem avalia, 1ª pessoa para a autoavaliação).
Três perguntas abertas: continuar, começar, parar.

## Cálculo
- Nota da dimensão por avaliação = média dos itens respondidos; nota do grupo = média das avaliações do grupo.
- **Visão dos avaliadores** (360°) = avaliadores anônimos somados (pares + equipe + outros), **sem o gestor**, que aparece à parte.
  No 180°, a referência é o gestor.
- **Diferença** = autoavaliação − referência.
  - **Ponto cego**: diferença ≥ +0,5 (padrão).
  - **Força escondida**: diferença ≤ −0,5.
  - **Força reconhecida**: alinhado e referência ≥ 4,0. **Prioridade de desenvolvimento**: alinhado e referência < 3,0.
- **Divergência**: desvio-padrão entre avaliadores ≥ 1,0 na dimensão sinaliza que cada pessoa vê algo diferente.
- Itens: ranking de maiores forças e maiores oportunidades (olhar dos outros), pontos cegos e forças escondidas por item.

## Anonimato
- Grupos anônimos (pares, equipe, outros) só aparecem com **no mínimo 3** respostas (configurável por grupo).
- Grupos pequenos são **somados** em “Demais avaliadores” se juntos atingirem o mínimo; senão ficam **ocultos e não entram em nenhuma média**
  (evita deduzir o grupo oculto por subtração).
- Gestor e autoavaliação são identificados. Comentários de grupos anônimos saem sem identificação e embaralhados.
- Os convites dos grupos anônimos usam um link coletivo por pessoa avaliada.

## Relatório
Participação, resumo, radar (auto × avaliadores × gestor), tabela por dimensão, comportamentos em destaque,
comentários, roteiro de devolutiva e quadro de PDI. Imprimível/PDF.
Rodapé obrigatório: leitura para desenvolvimento, não nota de desempenho.

## Parametrizável (`360-config.json`)
Modos e grupos, mínimos de anonimato, escala e rótulos, limiares de leitura (`limiarGap`, `forte`, `desenvolver`, `divergenciaDP`),
dimensões, itens (ligar/desligar, redação), perguntas abertas.

## Acesso, token e portal (backend)
Arquivos: `APPS_SCRIPT_360.gs` (planilha própria), `360-api.js` (URL do backend), `360-portal.html`.
- **Respondente:** link `360.html?t=ABCD-EFGH`. O token vale para **uma pessoa avaliada e um grupo**; o servidor define empresa, ciclo,
  formato, pessoa avaliada e grupo (o navegador não consegue trocar). Autoavaliação e gestor: 1 uso. Pares, equipe e outros: token coletivo
  com limite de respostas (padrão 4, 5 e 3), ajustável pelo admin sem poder ficar abaixo dos usos já feitos.
- **Anonimato:** o token não é gravado na resposta e a data é gravada sem hora. A regra do mínimo de 3 é aplicada ao gerar o relatório.
- **Admin (IDL):** `360-admin.html` pede a chave `ADMIN_SECRET` (Propriedades do script). Gera os convites (um código por grupo, idempotente),
  mostra uso por link, ajusta limite, define a senha do portal e gera o relatório.
- **Empresa:** `360-portal.html` (empresa + senha), somente **participação e links**: quem já respondeu e quem falta. Não recebe notas, comentários
  nem relatórios (o IDL entrega). Bloqueio de 15 min após 10 senhas erradas.
- Sem backend (`API_360` vazio em `360-api.js`), tudo roda em modo teste local, sem token. `360.html?teste=1` força a prévia local.

## Publicação
1. Implante `APPS_SCRIPT_360.gs` (instruções no topo): planilha nova, `ADMIN_SECRET`, implantação como App da Web.
2. Cole a URL `/exec` em `API_360` no `360-api.js` e publique os arquivos.
3. Proteja `360-admin.html` com Cloudflare Access (mesma política do `admin.html`) além da chave.
4. Restrinja o compartilhamento da planilha: quem a abre vê as respostas brutas.
5. Para atualizar o script depois: Implantar → Gerenciar implantações → lápis → Nova versão (nunca "Nova implantação").

## Estado e pendências
- **Pronto e testado:** questionário, motor de cálculo, painel, relatório, backend, portal.
  O backend foi testado contra uma **simulação local do Apps Script** (28 verificações: limites de token, validação de payload, token fora da planilha,
  portal sem vazamento, bloqueio de tentativas) e de ponta a ponta no navegador contra essa simulação. **Não foi testado contra uma implantação real do Google**:
  na primeira implantação, confirmar que o `fetch` lê a resposta do POST (mesmo ponto em aberto do Clima).
- **Decisões do IDL ainda abertas:** se o relatório vai só ao avaliado, ao avaliado + gestor ou também ao RH (hoje o IDL entrega); modelo único de 8
  dimensões ou versão por cliente; texto dos convites por e-mail.
- Limites conhecidos: o admin e quem acessa a planilha enxergam respostas brutas; a planilha guarda a ordem de gravação.
- Itens são de redação própria; validar estatisticamente (alfa de Cronbach) após 100–200 avaliações.
