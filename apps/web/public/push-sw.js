self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Plandit" };
  event.waitUntil(self.registration.showNotification(data.title || "Plandit", {
    body: data.body,
    icon: "/favicon.ico",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});
