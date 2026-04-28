import { MainLayout } from "@/components/layout/main-layout";
import { useListUsers, useCreateUser, useUpdateUser, useDeleteUser, getAuthToken } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { Icons } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHero } from "@/components/ui/page-hero";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiUrl } from "@/lib/api-url";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador", supervisor: "Supervisor", client: "Cliente",
  worker: "Trabajador", proveedor: "Proveedor",
};
const ROLE_COLORS: Record<string, string> = {
  admin: "#C8952A", supervisor: "#3B82F6", client: "#10B981",
  worker: "#EF4444", proveedor: "#8B5CF6",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado",
};

type ModalMode = "create" | "edit";

interface UserForm {
  name: string; email: string; password: string;
  role: string; phone: string; company: string; isActive: boolean;
}

const EMPTY_FORM: UserForm = {
  name: "", email: "", password: "", role: "worker", phone: "", company: "", isActive: true,
};

async function approveUser(id: number): Promise<void> {
  const token = await getAuthToken();
  const res = await fetch(apiUrl(`/api/users/${id}/approve`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("Error al aprobar");
}

async function rejectUser(id: number): Promise<void> {
  const token = await getAuthToken();
  const res = await fetch(apiUrl(`/api/users/${id}/reject`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("Error al rechazar");
}

export default function Usuarios() {
  const { user: appUser } = useAuth();
  const { data: users = [], isLoading, refetch } = useListUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const { toast } = useToast();

  const [modal, setModal] = useState<{ open: boolean; mode: ModalMode; editId?: number }>({ open: false, mode: "create" });
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [approving, setApproving] = useState<number | null>(null);

  const pendingUsers = users.filter((u: any) => u.approvalStatus === "pending");
  const activeUsers = users.filter((u: any) => u.approvalStatus !== "pending");

  const openCreate = () => { setForm(EMPTY_FORM); setModal({ open: true, mode: "create" }); };
  const openEdit = (user: any) => {
    setForm({ name: user.name, email: user.email, password: "", role: user.role,
      phone: user.phone ?? "", company: user.company ?? "", isActive: user.isActive ?? true });
    setModal({ open: true, mode: "edit", editId: user.id });
  };
  const close = () => setModal({ open: false, mode: "create" });

  const handleApprove = async (id: number) => {
    setApproving(id);
    try {
      await approveUser(id);
      toast({ title: "Usuario aprobado", description: "El usuario ya puede acceder al sistema." });
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo aprobar el usuario." });
    } finally { setApproving(null); }
  };

  const handleReject = async (id: number) => {
    setApproving(id);
    try {
      await rejectUser(id);
      toast({ title: "Solicitud rechazada", description: "El usuario no tendrá acceso." });
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo rechazar la solicitud." });
    } finally { setApproving(null); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || (modal.mode === "create" && !form.password)) {
      toast({ variant: "destructive", title: "Campos requeridos", description: "Nombre, email y contraseña son obligatorios." });
      return;
    }
    setSubmitting(true);
    try {
      if (modal.mode === "create") {
        await createUser.mutateAsync({
          data: { name: form.name, email: form.email, password: form.password, role: form.role as any,
            phone: form.phone || null, company: form.company || null },
        });
        toast({ title: "Usuario Creado", description: `${form.name} fue agregado al sistema.` });
      } else {
        await updateUser.mutateAsync({
          id: modal.editId!, data: { name: form.name, role: form.role,
            phone: form.phone || null, company: form.company || null, isActive: form.isActive },
        });
        toast({ title: "Usuario Actualizado", description: `${form.name} fue modificado.` });
      }
      close();
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo guardar el usuario." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteUser.mutateAsync({ id });
      toast({ title: "Usuario Eliminado", description: "El usuario fue removido del sistema." });
      setConfirmDelete(null);
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "No se pudo eliminar el usuario." });
    }
  };

  if (!appUser || appUser.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  return (
    <MainLayout>
      <div className="space-y-6 pb-4">
        <PageHero
          title="Equipo de Trabajo"
          subtitle="Gestión de accesos, roles y aprobaciones del personal de CASTORES"
          imageUrl="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1400&q=80&fit=crop"
          accentColor="#C8952A"
          badge="GESTIÓN DE PERSONAL"
        >
          <button onClick={openCreate}
            className="mt-1 text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
            style={{ background: "rgba(200,149,42,0.25)", border: "1px solid rgba(200,149,42,0.5)", color: "#fff" }}>
            + Agregar Usuario
          </button>
        </PageHero>

        {/* ─── Panel de Aprobaciones Pendientes ─── */}
        <AnimatePresence>
          {pendingUsers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl overflow-hidden"
              style={{ border: "1.5px solid rgba(200,149,42,0.3)", background: "rgba(200,149,42,0.04)" }}
            >
              <div className="px-5 py-3.5 border-b flex items-center gap-2.5" style={{ borderColor: "rgba(200,149,42,0.2)" }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#C8952A" }}>
                  {pendingUsers.length}
                </div>
                <div>
                  <h3 className="font-bold text-sm" style={{ color: "#1a1612" }}>Solicitudes de acceso pendientes</h3>
                  <p className="text-xs" style={{ color: "rgba(0,0,0,0.4)" }}>Revisa y aprueba o rechaza cada solicitud</p>
                </div>
              </div>

              <div className="divide-y" style={{ borderColor: "rgba(200,149,42,0.12)" }}>
                {pendingUsers.map((user: any) => (
                  <div key={user.id} className="px-5 py-3.5 flex items-center gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="font-bold text-sm" style={{ background: "rgba(200,149,42,0.12)", color: "#C8952A" }}>
                        {user.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-[#1a1612] truncate">{user.name}</p>
                      <p className="text-xs text-[#1a1612]/40 truncate">{user.email}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${ROLE_COLORS[user.role] ?? "#C8952A"}15`, color: ROLE_COLORS[user.role] ?? "#C8952A", border: `1px solid ${ROLE_COLORS[user.role] ?? "#C8952A"}25` }}>
                          {ROLE_LABELS[user.role] ?? user.role}
                        </span>
                        {user.company && (
                          <span className="text-[10px] text-[#1a1612]/35">{user.company}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleApprove(user.id)}
                        disabled={approving === user.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                        style={{ background: "#10B981" }}
                      >
                        {approving === user.id ? "..." : "Aprobar"}
                      </button>
                      <button
                        onClick={() => handleReject(user.id)}
                        disabled={approving === user.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90 disabled:opacity-50"
                        style={{ color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}
                      >
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Lista de Usuarios Activos ─── */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 bg-foreground/5 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeUsers.map((user: any, i: number) => {
              const color = ROLE_COLORS[user.role] ?? "#C8952A";
              const isRejected = user.approvalStatus === "rejected";
              return (
                <motion.div key={user.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-white rounded-2xl p-4 flex items-center gap-4"
                  style={{
                    border: isRejected ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(0,0,0,0.07)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                    opacity: isRejected ? 0.7 : 1,
                  }}>
                  <Avatar className="h-12 w-12 shrink-0" style={{ border: `2px solid ${color}30` }}>
                    <AvatarImage src={user.avatarUrl || undefined} />
                    <AvatarFallback className="font-bold text-sm" style={{ background: `${color}15`, color }}>
                      {user.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-foreground truncate">{user.name}</h3>
                    <p className="text-xs text-muted-foreground truncate mb-1.5">{user.email}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                      {!user.isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/6 text-muted-foreground border border-foreground/10">
                          Inactivo
                        </span>
                      )}
                      {isRejected && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full text-red-500 border border-red-200 bg-red-50">
                          Rechazado
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => openEdit(user)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground/30 hover:text-primary hover:bg-primary/8 transition-all">
                      <Icons.Edit className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(user.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground/30 hover:text-red-500 hover:bg-red-50 transition-all">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Modal Crear/Editar Usuario ─── */}
      <AnimatePresence>
        {modal.open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }}
              onClick={close} />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="fixed inset-x-4 top-[8%] z-50 rounded-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px]"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="font-display text-2xl text-foreground">
                      {modal.mode === "create" ? "Agregar Usuario" : "Editar Usuario"}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {modal.mode === "create" ? "Nuevo acceso al sistema" : "Modifica los datos del usuario"}
                    </p>
                  </div>
                  <button onClick={close}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/40 hover:bg-foreground/8 transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3.5">
                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Nombre Completo *</label>
                    <Input placeholder="Ej. Carlos Rodríguez" value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  {modal.mode === "create" && (
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Correo Electrónico *</label>
                      <Input type="email" placeholder="correo@empresa.com" value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        className="h-11 rounded-xl border-black/10" />
                    </div>
                  )}

                  {modal.mode === "create" && (
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Contraseña *</label>
                      <Input type="password" placeholder="Mínimo 6 caracteres" value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                        className="h-11 rounded-xl border-black/10" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Rol *</label>
                      <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                        <SelectTrigger className="h-11 rounded-xl border-black/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="supervisor">Supervisor</SelectItem>
                          <SelectItem value="client">Cliente</SelectItem>
                          <SelectItem value="worker">Trabajador</SelectItem>
                          <SelectItem value="proveedor">Proveedor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {modal.mode === "edit" && (
                      <div>
                        <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Estado</label>
                        <Select value={form.isActive ? "active" : "inactive"}
                          onValueChange={v => setForm(f => ({ ...f, isActive: v === "active" }))}>
                          <SelectTrigger className="h-11 rounded-xl border-black/10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Activo</SelectItem>
                            <SelectItem value="inactive">Inactivo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Teléfono</label>
                    <Input placeholder="+52 55 1234 5678" value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">Empresa / Contratista</label>
                    <Input placeholder="Nombre de empresa" value={form.company}
                      onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                      className="h-11 rounded-xl border-black/10" />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button type="button" variant="outline" onClick={close}
                      className="flex-1 rounded-xl border-black/10">Cancelar</Button>
                    <Button type="submit" disabled={submitting} className="flex-1 rounded-xl font-bold"
                      style={{ background: "#C8952A", color: "#fff" }}>
                      {submitting ? "Guardando..." : modal.mode === "create" ? "Crear Usuario" : "Guardar Cambios"}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Confirm Delete ─── */}
      <AnimatePresence>
        {confirmDelete !== null && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }}
              onClick={() => setConfirmDelete(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 rounded-2xl p-6"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}
            >
              <h3 className="font-display text-xl mb-2">¿Eliminar usuario?</h3>
              <p className="text-sm text-muted-foreground mb-5">Esta acción no se puede deshacer.</p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setConfirmDelete(null)} className="flex-1 rounded-xl border-black/10">Cancelar</Button>
                <Button onClick={() => handleDelete(confirmDelete!)} className="flex-1 rounded-xl font-bold bg-red-500 hover:bg-red-600 text-white">
                  Eliminar
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MainLayout>
  );
}
