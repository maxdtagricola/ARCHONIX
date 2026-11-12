// Archonix — só pras notificações do sistema (ver src/notificacoesDoSistema.ts): mostra o aviso e, no
// clique, traz a aba do site pra frente. Não guarda nada em cache nem passa pelas requisições do site.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const id = evento.notification.data && evento.notification.data.id
  evento.waitUntil(
    (async () => {
      const abas = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((a) =>
        a.url.startsWith(self.registration.scope),
      )
      if (abas.length === 0) {
        await self.clients.openWindow(self.registration.scope)
        return
      }
      await abas[0].focus()
      // a aba que mostrou o aviso sabe o que abrir (as outras ignoram)
      for (const aba of abas) aba.postMessage({ tipo: 'notificacao-clicada', id })
    })(),
  )
})
