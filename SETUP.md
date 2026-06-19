# Controle Operacional — Aura 360 (PWA offline + Firebase)

App de registro diário da área de processo. **Funciona offline** (salva no
aparelho sem internet) e **sincroniza sozinho ao reconectar**. Login obrigatório.

Telas: **Tanques** (% de reagente), **Bolas** (bags por diâmetro), **Floculante**
(consumo), **GLP** (%), **Histórico**, **Gráfico** e **Cadastros**.

```
controle-operacional/
├── index.html            ← interface (visual Aura 360)
├── app.js                ← lógica (login, navegação, Firestore offline, telas)
├── firebase-config.js    ← VOCÊ preenche com os dados do seu Firebase
├── manifest.webmanifest  ← deixa o app instalável
├── sw.js                 ← service worker (abre offline)
├── icon.svg              ← ícone
├── firestore.rules       ← regras de segurança (colar no Firebase)
└── SETUP.md              ← este guia
```

## Passo 1 — Projeto no Firebase
1. https://console.firebase.google.com → **Adicionar projeto** (ex.: `controle-operacional`).

## Passo 2 — Firestore
1. **Build > Firestore Database > Criar banco** → região `southamerica-east1` → modo produção.

## Passo 3 — Login (Authentication)
1. **Build > Authentication > Começar** → ative **E-mail/senha**.
2. **Users > Adicionar usuário**: crie a conta da equipe (ex.: `equipe@processo.com` + senha forte).
   Essa é a senha que a equipe usará para entrar.

## Passo 4 — Config do app Web
1. **Configurações do projeto > Geral > Seus aplicativos > `</>` (Web)** → registrar.
2. Copie o `firebaseConfig` e cole em `firebase-config.js` (substitua os `COLE_AQUI`).

## Passo 5 — Regras de segurança
1. **Firestore Database > Regras** → cole o conteúdo de `firestore.rules` → **Publicar**.

## Passo 6 — Publicar (GitHub Pages)
1. Crie um repositório (ex.: `controle-operacional`) **vazio** no GitHub.
2. `git push` desta pasta para ele.
3. **Settings > Pages > Source: Deploy from a branch → main** → salvar.
4. Link final: `https://SEU-USUARIO.github.io/controle-operacional/`

## Passo 7 — Autorizar domínio
1. **Authentication > Settings > Authorized domains > Add domain** → `SEU-USUARIO.github.io`.

---

## Uso
- Abra o link, **faça login**, e no celular use **"Adicionar à tela inicial"** para instalar.
- A **barra de status** mostra 🟢 sincronizado / 🟠 offline / enviando pendências.
- Registros feitos offline sobem sozinhos ao voltar a internet.

## Sobre o erro "IndexedDB ... denied" que você viu no protótipo
Aquilo acontece quando a página roda dentro de um **visualizador isolado**
(sandbox) ou aba anônima — o navegador bloqueia o armazenamento local.
**No app publicado (GitHub Pages), aberto numa aba normal ou instalado, o
IndexedDB funciona** e o offline opera normalmente.

## Observações (compliance Aura)
- Login é **conta compartilhada** — registra o e-mail comum, não a pessoa.
  Dá para evoluir para login individual se precisar de auditoria.
- São dados operacionais: confirme a classificação antes de divulgar o link amplamente.
