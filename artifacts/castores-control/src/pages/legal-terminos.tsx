import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";
import { apiUrl } from "@/lib/api-url";

const FALLBACK_TERMS = `Bienvenido a Castores Control, plataforma operada por CASTORES Estructuras y Construcciones (en adelante, "la Empresa"). Al usar esta aplicación, aceptas estos Términos.

1. ACEPTACIÓN
El uso de la plataforma implica la aceptación expresa de estos Términos y de la Política de Privacidad. Si no estás de acuerdo, no debes utilizar el servicio.

2. USO DE LA PLATAFORMA
Castores Control es una herramienta interna para la gestión de proyectos de obra (bitácoras, materiales, reportes y documentos). Solo personas autorizadas mediante un código de invitación pueden registrarse.

3. RESPONSABILIDADES DEL USUARIO
- Mantener la confidencialidad de su cuenta y credenciales.
- Proporcionar información veraz y mantenerla actualizada.
- Hacer un uso lícito de la plataforma.
- No compartir su código de invitación con terceros no autorizados.

4. CUENTAS Y APROBACIÓN
El registro de nuevos usuarios queda sujeto a aprobación por parte de un administrador. La Empresa se reserva el derecho de aceptar, rechazar o suspender cuentas a su discreción.

5. INVITACIONES Y CÓDIGOS
Los códigos de invitación son personales y de uso único. Cualquier intento de fraude o suplantación resultará en la cancelación inmediata de la cuenta.

6. PROPIEDAD INTELECTUAL
Todo el contenido, marca, logotipos y software son propiedad de la Empresa. Queda prohibida su reproducción sin autorización.

7. LIMITACIÓN DE RESPONSABILIDAD
La plataforma se ofrece "tal cual". La Empresa no se responsabiliza por interrupciones del servicio, pérdida de datos por causas ajenas, ni por el uso indebido por parte de los usuarios.

8. PROTECCIÓN DE DATOS
El tratamiento de datos personales se rige por la Política de Privacidad y por la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (México).

9. SUSPENSIÓN O CANCELACIÓN
La Empresa puede suspender o cancelar cuentas que infrinjan estos Términos. El usuario puede solicitar la eliminación de su cuenta desde "Mi Cuenta".

10. CAMBIOS EN EL SERVICIO
Podemos modificar estos Términos en cualquier momento. Los cambios serán notificados dentro de la aplicación; el uso continuado implica aceptación.

11. CONTACTO
Para cualquier duda: WhatsApp +52 998 429 2748 o contacto a través de la app.

Última actualización: ${new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}.`;

export default function Terminos() {
  const { data } = useQuery<Array<{ id: number; title: string; body: string | null }>>({
    queryKey: ["content", "terms"],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/content?type=terms`));
      if (!r.ok) return [];
      return r.json();
    },
  });

  const item = data?.[0];
  const body = item?.body || FALLBACK_TERMS;

  return (
    <MainLayout publicAccess>
      <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto bg-card border border-border rounded-2xl p-6 md:p-10">
        <h1 className="font-bebas text-4xl tracking-wider mb-6">{item?.title || "TÉRMINOS Y CONDICIONES"}</h1>
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground/90 leading-relaxed">
          {body}
        </div>
      </motion.article>
    </MainLayout>
  );
}
