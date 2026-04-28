import { ActivityItem } from "@workspace/api-client-react";
import { Icons } from "@/lib/icons";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface ActivityFeedProps {
  activities: ActivityItem[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const getIcon = (type: string) => {
    switch (type) {
      case "log_created": return <Icons.Logs className="text-primary w-4 h-4" />;
      case "material_requested": return <Icons.Materials className="text-[#F39C12] w-4 h-4" />;
      case "material_approved": return <Icons.Check className="text-[#2ECC71] w-4 h-4" />;
      case "report_generated": return <Icons.Reports className="text-[#4A90D9] w-4 h-4" />;
      case "project_updated": return <Icons.Edit className="text-primary w-4 h-4" />;
      case "document_uploaded": return <Icons.Documents className="text-white w-4 h-4" />;
      default: return <Icons.Notifications className="text-muted-foreground w-4 h-4" />;
    }
  };

  const getBorderColor = (type: string) => {
    switch (type) {
      case "log_created": return "border-primary";
      case "material_requested": return "border-[#F39C12]";
      case "material_approved": return "border-[#2ECC71]";
      case "report_generated": return "border-[#4A90D9]";
      case "project_updated": return "border-primary";
      case "document_uploaded": return "border-white/50";
      default: return "border-muted";
    }
  };

  if (!activities?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Icons.Notifications className="w-12 h-12 mb-4 opacity-20" />
        <p>Sin actividad reciente</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-card-border before:to-transparent">
      {activities.map((activity, index) => (
        <motion.div
          key={activity.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.1 }}
          className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active"
        >
          <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 bg-sidebar shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_10px_rgba(0,0,0,0.5)] ${getBorderColor(activity.type)} z-10`}>
            {getIcon(activity.type)}
          </div>

          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-card border border-card-border p-4 rounded-xl shadow-md">
            <div className="flex justify-between items-start mb-1">
              <span className="text-xs font-bold text-primary uppercase tracking-wider">{activity.userName || 'Sistema'}</span>
              <time className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true, locale: es })}
              </time>
            </div>
            <p className="text-sm text-card-foreground leading-relaxed">{activity.description}</p>
            {activity.projectName && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sidebar border border-sidebar-border text-xs text-muted-foreground">
                <Icons.Projects className="w-3.5 h-3.5 text-primary" />
                {activity.projectName}
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
