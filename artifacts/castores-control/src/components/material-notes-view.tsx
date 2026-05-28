import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type Project } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Icons } from "@/lib/icons";
import { useToast } from "@/hooks/use-toast";
import { compressImageFile } from "@/lib/compress-image";

// ─── Tipos ────────────────────────────────────────────────────────────────────
//
// Tipos locales — el orval codegen no los conoce todavía y para mantener el
// PR acotado (sin reabrir el pipeline de codegen que ya nos costó varios
// rebuilds) los declaramos aquí. Cuando regeneremos el cliente generado,
// estos tipos se reemplazan por los importados desde @workspace/api-client-react.

export type NoteItem = {
  id: number;
  noteId: number | null;
  name: string;
  description: string | null;
  unit: string;
  quantityRequested: number;
  costPerUnit: number | null;
  totalCost: number | null;
  notes: string | null;
  status: string;
};

export type MaterialNote = {
  id: number;
  projectId: number;
  projectName: string | null;
  createdById: number;
  createdByName: string | null;
  noteDate: string;
  folio: string | null;
  supplierName: string | null;
  description: string | null;
  totalAmount: number;
  status: string;
  itemCount: number;
  createdAt: string;
};

type FormItem = {
  name: string;
  unit: string;
  quantityRequested: string;
  costPerUnit: string;
  notes: string;
};

const EMPTY_ITEM: FormItem = { name: "", unit: "pza", quantityRequested: "", costPerUnit: "", notes: "" };

const UNITS = ["pza", "kg", "ton", "m", "m²", "m³", "lt", "saco", "rollo", "caja", "juego", "varilla", "serv", "nota", "tramo"] as const;

const fmtMoney = (n: number | null | undefined) => {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
};

const monthLabel = (iso: string) => {
  try {
    const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
    return d.toLocaleDateString("es-MX", { year: "numeric", month: "long" });
  } catch { return iso; }
};

const todayIso = () => new Date().toISOString().slice(0, 10);

type GroupBy = "project" | "supplier" | "month" | "creator";

interface Props {
  canCreate: boolean;
}

export function MaterialNotesView({ canCreate }: Props) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("project");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [expandedNote, setExpandedNote] = useState<number | null>(null);

  // Notas y proyectos vía customFetch directo (sin pasar por el cliente
  // generado, así no dependemos de un nuevo codegen).
  const notesQ = useQuery<MaterialNote[]>({
    queryKey: ["material-notes"],
    queryFn: () => customFetch<MaterialNote[]>("/api/material-notes"),
  });
  const projectsQ = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => customFetch<Project[]>("/api/projects"),
  });

  const notes = notesQ.data ?? [];
  const projects = projectsQ.data ?? [];

  // Filtros (cliente). Sirven con cualquier tamaño esperado.
  const filtered = useMemo(() => {
    let xs = notes;
    if (filterProject !== "all") xs = xs.filter((n) => String(n.projectId) === filterProject);
    if (filterSupplier.trim()) {
      const needle = filterSupplier.trim().toLowerCase();
      xs = xs.filter((n) => (n.supplierName ?? "").toLowerCase().includes(needle));
    }
    return xs;
  }, [notes, filterProject, filterSupplier]);

  const grouped = useMemo(() => {
    const groups = new Map<string, MaterialNote[]>();
    for (const n of filtered) {
      let key: string;
      if (groupBy === "project") key = n.projectName ?? `Obra #${n.projectId}`;
      else if (groupBy === "supplier") key = n.supplierName?.trim() || "(sin proveedor)";
      else if (groupBy === "creator") key = n.createdByName ?? `Usuario #${n.createdById}`;
      else key = monthLabel(n.noteDate);

      const arr = groups.get(key) ?? [];
      arr.push(n);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({
      label,
      total: items.reduce((acc, it) => acc + (it.totalAmount ?? 0), 0),
      count: items.length,
      items,
    }));
  }, [filtered, groupBy]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {canCreate && (
          <Button
            onClick={() => setShowForm(true)}
            className="rounded-xl font-bold"
            style={{ background: "#C8952A", color: "#fff" }}
          >
            <Icons.Plus className="w-4 h-4 mr-1.5" /> Nueva nota
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="w-[180px] h-9 rounded-xl border-black/10 text-xs">
              <SelectValue placeholder="Agrupar por" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">Agrupar por obra</SelectItem>
              <SelectItem value="supplier">Agrupar por proveedor</SelectItem>
              <SelectItem value="creator">Agrupar por solicitante</SelectItem>
              <SelectItem value="month">Agrupar por mes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-[180px] h-9 rounded-xl border-black/10 text-xs">
              <SelectValue placeholder="Obra" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las obras</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Filtrar por proveedor…"
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="w-[200px] h-9 rounded-xl border-black/10 text-xs"
          />
        </div>
      </div>

      {/* Lista agrupada */}
      {notesQ.isLoading && (
        <p className="text-sm text-muted-foreground py-12 text-center">Cargando notas…</p>
      )}
      {!notesQ.isLoading && filtered.length === 0 && (
        <div className="text-center py-16 bg-sidebar/30 border border-dashed border-card-border rounded-2xl">
          <Icons.Materials className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {notes.length === 0 ? "Aún no hay notas. Crea la primera con \"+ Nueva nota\"." : "No hay notas con esos filtros."}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map((g) => (
          <section key={g.label}>
            <header className="flex items-baseline justify-between mb-2 px-1">
              <div className="flex items-baseline gap-2">
                <h3 className="font-display tracking-wide text-base text-foreground">{g.label}</h3>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {g.count} {g.count === 1 ? "nota" : "notas"}
                </span>
              </div>
              <span className="text-sm font-bold tabular-nums" style={{ color: "#C8952A" }}>{fmtMoney(g.total)}</span>
            </header>
            <div className="space-y-2">
              {g.items.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  expanded={expandedNote === n.id}
                  onToggle={() => setExpandedNote((cur) => (cur === n.id ? null : n.id))}
                  onDeleted={() => { notesQ.refetch(); toast({ title: "Nota eliminada" }); }}
                  onEdited={() => { notesQ.refetch(); }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <AnimatePresence>
        {showForm && (
          <NewNoteModal
            projects={projects}
            onClose={() => setShowForm(false)}
            onCreated={() => { setShowForm(false); notesQ.refetch(); toast({ title: "Nota guardada" }); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Renglón de una nota (collapsable) ───────────────────────────────────────
function NoteRow({
  note,
  expanded,
  onToggle,
  onDeleted,
  onEdited,
}: {
  note: MaterialNote;
  expanded: boolean;
  onToggle: () => void;
  onDeleted: () => void;
  onEdited: () => void;
}) {
  const [items, setItems] = useState<NoteItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editFolio, setEditFolio] = useState("");
  const [editSupplier, setEditSupplier] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editItems, setEditItems] = useState<FormItem[]>([{ ...EMPTY_ITEM }]);
  const [editSaving, setEditSaving] = useState(false);
  const { toast } = useToast();

  const openEdit = () => {
    setEditDate(note.noteDate ?? todayIso());
    setEditFolio(note.folio ?? "");
    setEditSupplier(note.supplierName ?? "");
    setEditDescription(note.description ?? "");
    setEditItems(
      items && items.length > 0
        ? items.map((it) => ({
            name: it.name,
            unit: it.unit,
            quantityRequested: String(it.quantityRequested),
            costPerUnit: it.costPerUnit != null ? String(it.costPerUnit) : "",
            notes: it.notes ?? "",
          }))
        : [{ ...EMPTY_ITEM }]
    );
    setEditOpen(true);
  };

  const updateEditItem = (idx: number, patch: Partial<FormItem>) =>
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const handleEditSave = async () => {
    if (!editDate) { toast({ variant: "destructive", title: "Falta la fecha de la nota" }); return; }
    const badIdx = editItems.findIndex(
      (it) => !it.name.trim() || !it.unit.trim() || !it.quantityRequested || Number(it.quantityRequested) <= 0
    );
    if (badIdx >= 0) {
      toast({ variant: "destructive", title: `Renglón ${badIdx + 1} incompleto` }); return;
    }
    setEditSaving(true);
    try {
      await customFetch(`/api/material-notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          noteDate: editDate,
          folio: editFolio.trim() || null,
          supplierName: editSupplier.trim() || null,
          description: editDescription.trim() || null,
          items: editItems.map((it) => ({
            name: it.name.trim(),
            unit: it.unit,
            quantityRequested: Number(it.quantityRequested),
            costPerUnit: it.costPerUnit ? Number(it.costPerUnit) : null,
            notes: it.notes || null,
          })),
        }),
      });
      setItems(null); // force re-fetch on next expand
      setEditOpen(false);
      onEdited();
      toast({ title: "Nota actualizada" });
    } catch (e) {
      const apiErr = e as { data?: { error?: string } };
      toast({ variant: "destructive", title: "Error al guardar", description: apiErr?.data?.error ?? (e instanceof Error ? e.message : "Error") });
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    if (!expanded || items != null) return;
    let cancelled = false;
    setLoadingItems(true);
    customFetch<MaterialNote & { items: NoteItem[] }>(`/api/material-notes/${note.id}`)
      .then((r) => { if (!cancelled) setItems(r.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoadingItems(false); });
    return () => { cancelled = true; };
  }, [expanded, items, note.id]);

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar la nota del ${note.noteDate} con ${note.itemCount} renglón(es)?`)) return;
    setDeleting(true);
    try {
      // customFetch adjunta el Bearer token de Clerk automáticamente.
      // Antes usábamos fetch crudo con credentials:'include' y eso solo
      // mandaba la cookie de sesión, no el JWT — el server respondía 401
      // y el toast decía "Error" sin pista.
      await customFetch(`/api/material-notes/${note.id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Falló el borrado" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-foreground/[0.02] transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">
              {note.supplierName?.trim() || (note.folio ? `Folio ${note.folio}` : "Nota de materiales")}
            </p>
            {note.folio && note.supplierName && (
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">F-{note.folio}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {note.noteDate} · {note.itemCount} {note.itemCount === 1 ? "concepto" : "conceptos"}
            {note.createdByName ? ` · ${note.createdByName}` : ""}
          </p>
        </div>
        <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: "#C8952A" }}>
          {fmtMoney(note.totalAmount)}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="border-t border-card-border bg-sidebar/30"
          >
            <div className="px-4 py-3 space-y-2">
              {loadingItems && (
                <p className="text-xs text-muted-foreground italic">Cargando renglones…</p>
              )}
              {!loadingItems && items && items.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Sin renglones registrados.</p>
              )}
              {items?.map((it) => (
                <div key={it.id} className="flex items-baseline gap-3 text-xs">
                  <span className="flex-1 min-w-0 truncate font-medium text-foreground">{it.name}</span>
                  <span className="font-mono text-muted-foreground shrink-0">{it.quantityRequested} {it.unit}</span>
                  {it.costPerUnit != null && (
                    <span className="font-mono text-muted-foreground shrink-0 hidden sm:inline">× {fmtMoney(it.costPerUnit)}</span>
                  )}
                  <span className="font-mono font-semibold tabular-nums shrink-0" style={{ color: "#C8952A" }}>
                    {fmtMoney(it.totalCost ?? 0)}
                  </span>
                </div>
              ))}
              {note.description && (
                <p className="text-xs text-muted-foreground italic pt-1 border-t border-card-border/60">
                  {note.description}
                </p>
              )}
              <div className="pt-2 flex justify-between items-center">
                <button
                  onClick={openEdit}
                  disabled={deleting || editSaving}
                  className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  ✏️ Editar nota
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting || editSaving}
                  className="text-[11px] font-semibold text-destructive hover:underline disabled:opacity-50"
                >
                  {deleting ? "Eliminando…" : "🗑️ Eliminar nota"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Modal de edición ───────────────────────────────────────── */}
      <AnimatePresence>
        {editOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => !editSaving && setEditOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: "spring", stiffness: 360, damping: 32 }}
              className="fixed inset-x-3 top-[3%] bottom-[3%] z-50 overflow-y-auto rounded-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[680px]"
              style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}
            >
              <div className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-display text-2xl text-foreground">Editar nota de materiales</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Los renglones se reemplazan por completo al guardar.</p>
                  </div>
                  <button onClick={() => !editSaving && setEditOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/40 hover:bg-foreground/8">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Fecha de la nota *">
                    <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="h-11 rounded-xl border-black/10" />
                  </Field>
                  <Field label="Folio (opcional)">
                    <Input value={editFolio} onChange={(e) => setEditFolio(e.target.value)} placeholder="Ej. 1234" className="h-11 rounded-xl border-black/10" />
                  </Field>
                  <Field label="Proveedor (opcional)">
                    <Input value={editSupplier} onChange={(e) => setEditSupplier(e.target.value)} placeholder="Ej. Cemex, Acero del Norte" className="h-11 rounded-xl border-black/10" />
                  </Field>
                  <Field label="Descripción (opcional)">
                    <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Observaciones generales" className="h-11 rounded-xl border-black/10" />
                  </Field>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm">Conceptos</h3>
                    <button type="button" onClick={() => setEditItems((prev) => [...prev, { ...EMPTY_ITEM }])} className="text-xs font-bold text-amber-700 hover:underline">
                      + Agregar concepto
                    </button>
                  </div>
                  {editItems.map((it, i) => (
                    <div key={i} className="rounded-xl border border-card-border p-3 bg-sidebar/20 space-y-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Concepto {i + 1}</span>
                        {editItems.length > 1 && (
                          <button type="button" onClick={() => setEditItems((prev) => prev.filter((_, j) => j !== i))} className="text-[10px] font-semibold text-destructive hover:underline">
                            Quitar
                          </button>
                        )}
                      </div>
                      <Input value={it.name} onChange={(e) => updateEditItem(i, { name: e.target.value })} placeholder="Ej. Acero 5/8 grado 60" className="h-10 rounded-lg border-black/10" />
                      <div className="grid grid-cols-3 gap-2">
                        <Input type="number" min="0" step="0.01" value={it.quantityRequested} onChange={(e) => updateEditItem(i, { quantityRequested: e.target.value })} placeholder="Cantidad" className="h-10 rounded-lg border-black/10" />
                        <Select value={it.unit} onValueChange={(v) => updateEditItem(i, { unit: v })}>
                          <SelectTrigger className="h-10 rounded-lg border-black/10"><SelectValue /></SelectTrigger>
                          <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input type="number" min="0" step="0.01" value={it.costPerUnit} onChange={(e) => updateEditItem(i, { costPerUnit: e.target.value })} placeholder="$/unidad" className="h-10 rounded-lg border-black/10" />
                      </div>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-mono font-bold tabular-nums" style={{ color: "#C8952A" }}>
                          {fmtMoney((Number(it.quantityRequested) || 0) * (Number(it.costPerUnit) || 0))}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl p-4 flex items-baseline justify-between" style={{ background: "rgba(200,149,42,0.08)", border: "1px solid rgba(200,149,42,0.2)" }}>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total</span>
                  <span className="font-display text-2xl tabular-nums" style={{ color: "#C8952A" }}>
                    {fmtMoney(editItems.reduce((acc, it) => acc + (Number(it.quantityRequested) || 0) * (Number(it.costPerUnit) || 0), 0))}
                  </span>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving} className="flex-1 rounded-xl border-black/10">Cancelar</Button>
                  <Button onClick={handleEditSave} disabled={editSaving} className="flex-1 rounded-xl font-bold" style={{ background: "#C8952A", color: "#fff" }}>
                    {editSaving ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Modal: nueva nota con renglones dinámicos ───────────────────────────────
function NewNoteModal({
  projects,
  onClose,
  onCreated,
}: {
  projects: Project[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const [noteDate, setNoteDate] = useState(todayIso());
  const [folio, setFolio] = useState("");
  const [supplier, setSupplier] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<FormItem[]>([{ ...EMPTY_ITEM }]);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const total = useMemo(
    () => items.reduce((acc, it) => {
      const qty = Number(it.quantityRequested) || 0;
      const cost = Number(it.costPerUnit) || 0;
      return acc + qty * cost;
    }, 0),
    [items],
  );

  const update = (i: number, patch: Partial<FormItem>) =>
    setItems((xs) => xs.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const addRow = () => setItems((xs) => [...xs, { ...EMPTY_ITEM }]);
  const removeRow = (i: number) => setItems((xs) => xs.length === 1 ? xs : xs.filter((_, idx) => idx !== i));

  // Tipo del response del endpoint /scan — espejado del backend.
  type ScanResult = {
    ok: boolean;
    supplierName?: string | null;
    folio?: string | null;
    noteDate?: string | null;
    items?: Array<{ name: string; unit: string; quantityRequested: number; costPerUnit: number | null }>;
    confidence?: number;
    pending?: boolean;
    message?: string;
  };

  const onScanFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reseteamos el input para que si el usuario reescanea la misma foto,
    // el change event vuelva a disparar.
    if (e.target) e.target.value = "";
    if (!file) return;

    setScanning(true);
    try {
      // Compresión client-side: la nota suele ser 3-5MB del iPhone y
      // necesitamos quedar bajo el límite de Vercel (4.5 MB request body)
      // y reducir costo de tokens en OpenRouter.
      const dataUrl = await compressImageFile(file);

      const result = await customFetch<ScanResult>("/api/material-notes/scan", {
        method: "POST",
        body: JSON.stringify({ image: dataUrl }),
      });

      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Escaneo no disponible",
          description: result.message ?? "El servicio de visión no está disponible en este momento.",
        });
        return;
      }

      const extractedItems = result.items ?? [];
      if (extractedItems.length === 0) {
        toast({
          variant: "destructive",
          title: "No se reconocieron conceptos",
          description: "La foto no es legible o no parece una nota. Inténtalo con mejor luz o captura manualmente.",
        });
        return;
      }

      // Pre-rellenar cabecera (solo campos vacíos para no pisar lo que
      // el usuario ya escribió a mano).
      if (result.supplierName && !supplier.trim()) setSupplier(result.supplierName);
      if (result.folio && !folio.trim()) setFolio(result.folio);
      if (result.noteDate && /^\d{4}-\d{2}-\d{2}$/.test(result.noteDate)) setNoteDate(result.noteDate);

      // Reemplazar renglones por los extraídos. El usuario revisa y
      // edita antes de "Guardar nota".
      setItems(extractedItems.map((it) => ({
        name: it.name,
        unit: it.unit,
        quantityRequested: String(it.quantityRequested),
        costPerUnit: it.costPerUnit != null ? String(it.costPerUnit) : "",
        notes: "",
      })));

      const conf = result.confidence ?? 0;
      toast({
        title: `📷 ${extractedItems.length} concepto${extractedItems.length === 1 ? "" : "s"} extraído${extractedItems.length === 1 ? "" : "s"}`,
        description: conf >= 0.8
          ? "Revisa los datos y guarda la nota."
          : "La foto se leyó pero con baja confianza — revisa cada renglón antes de guardar.",
      });
    } catch (err) {
      // customFetch lanza ApiError con el body del server en .data.
      // Sacamos el error humano + el detail técnico para que el dueño
      // pueda mandarnos un screenshot útil si reporta un fallo.
      let msg = "No se pudo procesar la foto.";
      let diag: string | undefined;
      const apiErr = err as { data?: { error?: string; message?: string; diagnostic?: string } };
      if (apiErr?.data?.error) msg = apiErr.data.error;
      else if (apiErr?.data?.message) msg = apiErr.data.message;
      else if (err instanceof Error) msg = err.message;
      if (apiErr?.data?.diagnostic) diag = apiErr.data.diagnostic;
      toast({
        variant: "destructive",
        title: "Error al escanear",
        description: diag ? `${msg}\n\nDetalle: ${diag}` : msg,
      });
    } finally {
      setScanning(false);
    }
  };

  const handleScanReceipt = () => {
    scanInputRef.current?.click();
  };

  const handleSubmit = async () => {
    if (!projectId) { toast({ variant: "destructive", title: "Selecciona la obra" }); return; }
    if (!noteDate) { toast({ variant: "destructive", title: "Falta la fecha de la nota" }); return; }
    const bad = items.findIndex((it) => !it.name.trim() || !it.unit.trim() || !it.quantityRequested || Number(it.quantityRequested) <= 0);
    if (bad >= 0) {
      toast({ variant: "destructive", title: `Renglón ${bad + 1} incompleto`, description: "Nombre, unidad y cantidad mayor a 0 son requeridos." });
      return;
    }
    setSubmitting(true);
    try {
      // customFetch adjunta automáticamente el Bearer token de Clerk en
      // el header Authorization. Antes usábamos fetch crudo con solo
      // credentials:'include', lo que mandaba la cookie pero NO el JWT.
      // En PWA (donde la sesión Clerk vive en localStorage, no cookie),
      // el server respondía 401 "No autenticado" y el toast decía
      // "Error al guardar" sin pista del por qué — ese era el bug del
      // registro reportado por el cliente.
      await customFetch("/api/material-notes", {
        method: "POST",
        body: JSON.stringify({
          projectId: Number(projectId),
          noteDate,
          folio: folio.trim() || null,
          supplierName: supplier.trim() || null,
          description: description.trim() || null,
          items: items.map((it) => ({
            name: it.name.trim(),
            unit: it.unit.trim(),
            quantityRequested: Number(it.quantityRequested),
            costPerUnit: it.costPerUnit ? Number(it.costPerUnit) : null,
            notes: it.notes.trim() || null,
          })),
        }),
      });
      onCreated();
    } catch (e) {
      toast({ variant: "destructive", title: "No se guardó la nota", description: e instanceof Error ? e.message : "Error desconocido" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }}
        onClick={() => !submitting && onClose()}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        className="fixed inset-x-3 top-[3%] bottom-[3%] z-50 overflow-y-auto rounded-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[680px]"
        style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-display text-2xl text-foreground">Nueva nota de materiales</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Captura varios conceptos en una sola nota — como una nota de mostrador.</p>
            </div>
            <button onClick={() => !submitting && onClose()} className="w-8 h-8 rounded-full flex items-center justify-center text-foreground/40 hover:bg-foreground/8">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Cabecera */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Obra *">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-11 rounded-xl border-black/10">
                  <SelectValue placeholder="Seleccionar obra" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha de la nota *">
              <Input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className="h-11 rounded-xl border-black/10" />
            </Field>
            <Field label="Folio (opcional)">
              <Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Ej. 1234" className="h-11 rounded-xl border-black/10" />
            </Field>
            <Field label="Proveedor (opcional)">
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ej. Cemex, Acero del Norte" className="h-11 rounded-xl border-black/10" />
            </Field>
          </div>

          {/* Botón OCR — abre el selector nativo de iOS/Android que da
              al usuario opciones "Tomar foto" o "Elegir de la biblioteca".
              Sin capture="environment" el SO muestra ambas opciones, lo
              que el dueño pidió porque a veces el proveedor le manda la
              nota por WhatsApp y ya tiene la imagen guardada. */}
          <input
            ref={scanInputRef}
            type="file"
            accept="image/*"
            onChange={onScanFileSelected}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleScanReceipt}
            disabled={scanning || submitting}
            className="w-full text-xs font-semibold py-3 rounded-xl border-2 border-dashed transition hover:bg-foreground/[0.02] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
            style={{ borderColor: "rgba(200,149,42,0.4)", color: "#C8952A" }}
          >
            <span className="text-base">📷</span>
            <span>{scanning ? "Leyendo la nota…" : "Escanear nota con foto"}</span>
            {scanning && (
              <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin ml-1" />
            )}
          </button>

          {/* Renglones dinámicos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Conceptos</h3>
              <button
                type="button"
                onClick={addRow}
                className="text-xs font-bold text-amber-700 hover:underline"
              >
                + Agregar concepto
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="rounded-xl border border-card-border p-3 bg-sidebar/20 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Concepto {i + 1}</span>
                    {items.length > 1 && (
                      <button type="button" onClick={() => removeRow(i)} className="text-[10px] font-semibold text-destructive hover:underline">
                        Quitar
                      </button>
                    )}
                  </div>
                  <Input
                    value={it.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="Ej. Acero 5/8 grado 60"
                    className="h-10 rounded-lg border-black/10"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="number" min="0" step="0.01"
                      value={it.quantityRequested}
                      onChange={(e) => update(i, { quantityRequested: e.target.value })}
                      placeholder="Cantidad"
                      className="h-10 rounded-lg border-black/10"
                    />
                    <Select value={it.unit} onValueChange={(v) => update(i, { unit: v })}>
                      <SelectTrigger className="h-10 rounded-lg border-black/10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number" min="0" step="0.01"
                      value={it.costPerUnit}
                      onChange={(e) => update(i, { costPerUnit: e.target.value })}
                      placeholder="$/unidad"
                      className="h-10 rounded-lg border-black/10"
                    />
                  </div>
                  {/* Subtotal del renglón */}
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono font-bold tabular-nums" style={{ color: "#C8952A" }}>
                      {fmtMoney((Number(it.quantityRequested) || 0) * (Number(it.costPerUnit) || 0))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Field label="Observaciones generales de la nota (opcional)">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="rounded-xl border-black/10 resize-none" />
          </Field>

          {/* Total */}
          <div className="rounded-xl p-4 flex items-baseline justify-between" style={{ background: "rgba(200,149,42,0.08)", border: "1px solid rgba(200,149,42,0.2)" }}>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total de la nota</span>
            <span className="font-display text-2xl tabular-nums" style={{ color: "#C8952A" }}>{fmtMoney(total)}</span>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1 rounded-xl border-black/10">Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 rounded-xl font-bold" style={{ background: "#C8952A", color: "#fff" }}>
              {submitting ? "Guardando…" : "Guardar nota"}
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
