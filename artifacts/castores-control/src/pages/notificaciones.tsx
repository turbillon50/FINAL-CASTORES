import { MainLayout } from "@/components/layout/main-layout";
import { useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@workspace/api-client-react";
import { Icons } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { motion } from "framer-motion";

export default function Notificaciones() {
  const { data: notifications = [], refetch } = useListNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const handleMarkRead = (id: number) => {
    markRead.mutate({ id }, { onSuccess: () => refetch() });
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, { onSuccess: () => refetch() });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'material_request': return <Icons.Materials className="w-5 h-5 text-[#F39C12]" />;
      case 'material_approved': return <Icons.Check className="w-5 h-5 text-[#2ECC71]" />;
      case 'log_submitted': return <Icons.Logs className="w-5 h-5 text-primary" />;
      case 'alert': return <Icons.Alert className="w-5 h-5 text-destructive" />;
      default: return <Icons.Notifications className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <MainLayout>
      <div className="max-w-3xl mx-auto space-y-8 pb-12">
        <header className="flex items-end justify-between border-b border-card-border pb-6">
          <div>
            <h1 className="font-display text-5xl tracking-wide">Notificaciones</h1>
            <p className="text-muted-foreground mt-2">Alertas y actualizaciones del sistema.</p>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" onClick={handleMarkAllRead} className="border-card-border hover:bg-card">
              <Icons.Check className="w-4 h-4 mr-2" /> Marcar Todo Leído
            </Button>
          )}
        </header>

        <div className="space-y-4">
          {notifications.map((notification, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              key={notification.id}
              className={`p-5 rounded-xl border flex gap-4 transition-colors ${
                notification.isRead
                  ? 'bg-background border-card-border opacity-70'
                  : 'bg-card border-primary/30 shadow-[0_0_15px_rgba(212,168,75,0.05)]'
              }`}
            >
              <div className="shrink-0 mt-1">
                {getIcon(notification.type)}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-1">
                  <h4 className={`font-semibold ${notification.isRead ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {notification.title}
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: es })}
                  </span>
                </div>
                <p className="text-sm text-card-foreground/80 mb-3">{notification.message}</p>
                {!notification.isRead && (
                  <button
                    onClick={() => handleMarkRead(notification.id)}
                    className="text-xs font-bold text-primary uppercase tracking-wider hover:underline"
                  >
                    Marcar como Leído
                  </button>
                )}
              </div>
            </motion.div>
          ))}

          {notifications.length === 0 && (
            <div className="text-center py-20 bg-sidebar/30 border border-dashed border-card-border rounded-xl">
              <Icons.Notifications className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <p className="text-muted-foreground">Todo al día. Sin notificaciones pendientes.</p>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
