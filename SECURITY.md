# Seguranca do Modo ADM

## Acesso oculto
- O painel ADM nao aparece na interface publica.
- Abertura apenas por atalho: `Ctrl + Shift + A` ou 5 cliques no logo.

## Autenticacao
- Defina `window.__admin_user` e `window.__admin_hash` antes de carregar `app.js`.
- O hash deve ser SHA-256 da senha em hexadecimal.
- Sessao ADM expira em 20 minutos.

Exemplo (no console do navegador):

```js
const senha = "bololo@12";
const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(senha));
const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
console.log(hash);
```

## Regra obrigatoria no backend (Firestore)
Somente esconder o painel no frontend nao protege o banco. Proteja com regra de escrita:

```txt
allow read: if true;
allow write: if request.auth != null && request.auth.token.admin == true;
```

Use token customizado no login admin real.
