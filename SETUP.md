# Controle Operacional — Aura 360 (PWA offline + Supabase)

App de registro diário da área de processo. **Funciona offline** (salva no
aparelho sem internet) e **sincroniza ao reconectar**. Login obrigatório.
Vários aparelhos veem os mesmos dados em tempo real.

> Base de dados: **Supabase** (você administra entrando com sua conta do **GitHub** — não precisa de Google).

```
controle-operacional/
├── index.html            ← interface (visual Aura 360)
├── app.js                ← lógica (login, telas, Supabase + camada offline)
├── supabase-config.js    ← VOCÊ preenche com URL + chave anon do seu Supabase
├── supabase-setup.sql    ← cria as tabelas + segurança (RLS) + realtime
├── manifest.webmanifest  ← deixa o app instalável
├── sw.js                 ← service worker (abre offline)
├── icon.svg              ← ícone
└── SETUP.md              ← este guia
```

## Passo 1 — Criar o projeto no Supabase
1. Acesse **https://supabase.com** → **Start your project** → entre com **GitHub**.
2. **New project** → escolha a Organização, dê um nome (ex.: `controle-operacional`).
3. Defina uma **Database Password** (guarde-a) e a região (ex.: São Paulo).
4. Aguarde o projeto provisionar (~1-2 min).

## Passo 2 — Criar as tabelas e a segurança
1. Menu lateral **SQL Editor** → **New query**.
2. Cole TODO o conteúdo de `supabase-setup.sql` → **Run**.
3. Deve aparecer "Success". Isso cria as 7 tabelas, ativa as regras de
   segurança (só logado acessa) e liga o tempo real.

## Passo 3 — Criar o usuário (login da equipe)
1. Menu **Authentication** → **Users** → **Add user** → **Create new user**.
2. E-mail (ex.: `equipe@processo.com`) + senha forte.
3. **Marque "Auto Confirm User"** (importante: senão o login pede confirmação por e-mail).
4. Esse é o e-mail + senha que a equipe vai usar para entrar no app.

> Dica: em **Authentication > Providers > Email**, confirme que **Email** está
> habilitado. Pode deixar "Confirm email" desligado para contas internas.

## Passo 4 — Pegar a configuração e colar no app
1. Menu **Project Settings** (engrenagem) → **API** (ou **Data API**).
2. Copie:
   - **Project URL** → cole em `SUPABASE_URL` no `supabase-config.js`
   - **anon public** (em Project API keys) → cole em `SUPABASE_ANON_KEY`
3. ⚠️ **Nunca** use a chave **service_role** aqui (ela é secreta).

## Passo 5 — Publicar a alteração
O app já está no GitHub Pages. Depois de preencher o `supabase-config.js`,
basta enviar a mudança (eu posso fazer o push por você):
```bash
git add supabase-config.js
git commit -m "Configura Supabase"
git push
```
Em ~1 min o Pages atualiza. Recarregue o app e o login funciona.

Link do app: `https://gabriel2840.github.io/controle-operacional/`

---

## Como funciona o offline (importante)
- **Cada aparelho precisa abrir o app conectado UMA vez** (para baixar o app e
  fazer o primeiro login). Depois disso, funciona offline.
- Offline: os registros ficam numa **fila local** e a barra de status mostra
  quantos estão aguardando. Ao reconectar, sobem sozinhos.
- Online: o que um aparelho registra aparece nos outros (Histórico/Gráfico) em
  segundos, com o aviso "🔔 registro recebido de outro aparelho".

## Observações (compliance Aura)
- Login é **conta compartilhada** — registra o e-mail comum, não a pessoa.
- São dados operacionais: confirme com a TI/governança onde os dados ficam
  hospedados antes de tornar oficial. A chave `anon` é pública por design;
  a proteção vem do login + RLS.
