import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const FALLBACK_PRIVACY = `CASTORES Estructuras y Construcciones (en adelante, "la Empresa") respeta tu privacidad. Esta política describe cómo recopilamos, usamos y protegemos tu información personal en Castores Control.

1. RESPONSABLE DEL TRATAMIENTO
CASTORES Estructuras y Construcciones, con domicilio en México. Contacto: WhatsApp +52 998 429 2748.

2. DATOS QUE RECOPILAMOS
- Identificación: nombre, correo electrónico, teléfono.
- Datos profesionales: rol, empresa, proyecto asignado.
- Datos de uso: bitácoras, fotografías de obra, reportes y documentos que cargues.
- Datos técnicos: identificador de dispositivo para notificaciones push, fechas de acceso.

3. FINALIDADES DEL TRATAMIENTO
- Operar la plataforma y brindarte acceso a las funciones contratadas.
- Coordinar la gestión de obras y comunicaciones internas.
- Enviar notificaciones operativas (avances, alertas, asignaciones).
- Cumplir obligaciones legales y de auditoría.

4. ALMACENAMIENTO
Tus datos se almacenan en servidores seguros en infraestructura de Replit (PostgreSQL) y proveedores autorizados de autenticación (Clerk). Aplicamos cifrado en tránsito (HTTPS) y controles de acceso.

5. COMPARTICIÓN DE DATOS
No vendemos tu información. Solo se comparte con proveedores que prestan servicios técnicos (autenticación, hosting, mensajería) bajo acuerdos de confidencialidad, o cuando lo exija la ley.

6. COOKIES Y ALMACENAMIENTO LOCAL
Usamos cookies y almacenamiento local del navegador para mantener la sesión activa, recordar preferencias y permitir el funcionamiento offline básico de la PWA.

7. DERECHOS ARCO
Tienes derecho de Acceso, Rectificación, Cancelación y Oposición sobre tus datos. Puedes ejercerlos:
- Editando tu perfil dentro de la app.
- Eliminando tu cuenta desde "Mi Cuenta → Eliminar mi cuenta".
- Escribiendo a soporte por WhatsApp.

8. ELIMINACIÓN DE CUENTA
Al eliminar tu cuenta, anonimizamos tus datos personales (nombre, correo, teléfono, foto) en un plazo inmediato. Conservamos registros mínimos necesarios para auditoría y cumplimiento legal.

9. MENORES DE EDAD
La plataforma está dirigida a personal profesional adulto. No recopilamos intencionalmente datos de menores.

10. CAMBIOS A ESTA POLÍTICA
Cualquier cambio será notificado dentro de la app. La fecha de la última actualización aparece al pie.

11. CONTACTO
WhatsApp: +52 998 429 2748.

Última actualización: ${new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}.`;

export default function Privacidad() {
  const { data } = useQuery<Array<{ id: number; title: string; body: string | null }>>({
    queryKey: ["content", "privacy"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/content?type=privacy`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const item = data?.[0];
  const body = item?.body || FALLBACK_PRIVACY;

  return (
    <MainLayout publicAccess>
      <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto bg-card border border-border rounded-2xl p-6 md:p-10">
        <h1 className="font-bebas text-4xl tracking-wider mb-6">{item?.title || "POLÍTICA DE PRIVACIDAD"}</h1>
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground/90 leading-relaxed">
          {body}
        </div>
      </motion.article>
    </MainLayout>
  );
}
