"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
    getGdoUsersForNotes,
    getGdoNotes,
    createGdoNote,
    deleteGdoNote,
    type GdoUserForNotes,
    type GdoNote,
    type GdoNoteCategory,
} from "@/app/actions/gdoNotesActions";
import { Users, Plus, Trash2, Filter, FileText, ChevronDown, ChevronUp } from "lucide-react";

const CATEGORIES: { value: GdoNoteCategory; label: string; color: string }[] = [
    { value: "formazione", label: "Formazione", color: "bg-blue-100 text-blue-800" },
    { value: "positivo", label: "Positivo", color: "bg-green-100 text-green-800" },
    { value: "negativo", label: "Negativo", color: "bg-red-100 text-red-800" },
    { value: "disciplinare", label: "Disciplinare", color: "bg-yellow-100 text-yellow-800" },
];

function getCategoryStyle(cat: GdoNoteCategory): string {
    return CATEGORIES.find(c => c.value === cat)?.color ?? "bg-gray-100 text-gray-800";
}

function getCategoryLabel(cat: GdoNoteCategory): string {
    return CATEGORIES.find(c => c.value === cat)?.label ?? cat;
}

export default function NoteGdoClient() {
    const { user: authUser } = useAuth();
    const currentUserId = authUser?.id ?? "";

    const [gdoUsers, setGdoUsers] = useState<GdoUserForNotes[]>([]);
    const [selectedGdoId, setSelectedGdoId] = useState<string | null>(null);
    const [notes, setNotes] = useState<GdoNote[]>([]);
    const [loadingNotes, setLoadingNotes] = useState(false);
    const [filterCategory, setFilterCategory] = useState<GdoNoteCategory | "all">("all");

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [formContent, setFormContent] = useState("");
    const [formCategory, setFormCategory] = useState<GdoNoteCategory>("formazione");
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

    // Expanded GDO cards (mobile-friendly accordion)
    const [expandedGdos, setExpandedGdos] = useState<Set<string>>(new Set());

    useEffect(() => {
        getGdoUsersForNotes().then(setGdoUsers).catch(() => {});
    }, []);

    const loadNotes = useCallback(async (gdoId: string) => {
        setLoadingNotes(true);
        try {
            const data = await getGdoNotes(gdoId);
            setNotes(data);
        } catch {
            setNotes([]);
        }
        setLoadingNotes(false);
    }, []);

    const handleSelectGdo = (gdoId: string) => {
        if (selectedGdoId === gdoId) {
            setSelectedGdoId(null);
            setNotes([]);
            setShowForm(false);
            setExpandedGdos(prev => { const n = new Set(prev); n.delete(gdoId); return n; });
        } else {
            setSelectedGdoId(gdoId);
            setShowForm(false);
            setFilterCategory("all");
            setFeedback(null);
            loadNotes(gdoId);
            setExpandedGdos(prev => new Set(prev).add(gdoId));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedGdoId || !formContent.trim()) return;
        setSaving(true);
        setFeedback(null);
        const result = await createGdoNote(selectedGdoId, currentUserId, formContent, formCategory);
        if (result.success) {
            setFeedback({ type: "success", msg: "Nota aggiunta" });
            setFormContent("");
            setShowForm(false);
            loadNotes(selectedGdoId);
        } else {
            setFeedback({ type: "error", msg: result.error ?? "Errore" });
        }
        setSaving(false);
        setTimeout(() => setFeedback(null), 3000);
    };

    const handleDelete = async (noteId: string) => {
        if (!selectedGdoId) return;
        const result = await deleteGdoNote(noteId, currentUserId);
        if (result.success) {
            loadNotes(selectedGdoId);
        }
    };

    const filteredNotes = filterCategory === "all"
        ? notes
        : notes.filter(n => n.category === filterCategory);

    const selectedGdo = gdoUsers.find(g => g.id === selectedGdoId);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left panel: GDO list */}
            <div className="lg:col-span-1">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-brand-orange" />
                            <h2 className="font-semibold text-gray-800">Operatori GDO</h2>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{gdoUsers.length} operatori attivi</p>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-[calc(100vh-260px)] overflow-y-auto">
                        {gdoUsers.map(gdo => (
                            <button
                                key={gdo.id}
                                onClick={() => handleSelectGdo(gdo.id)}
                                className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors ${
                                    selectedGdoId === gdo.id
                                        ? "bg-brand-orange/10 border-l-4 border-brand-orange"
                                        : "hover:bg-gray-50 border-l-4 border-transparent"
                                }`}
                            >
                                <div>
                                    <div className="font-medium text-gray-800">
                                        {gdo.displayName || gdo.name || "GDO"}
                                        {gdo.gdoCode ? <span className="text-xs text-gray-400 ml-2">#{gdo.gdoCode}</span> : null}
                                    </div>
                                    <div className="text-xs text-gray-500">Livello {gdo.level}</div>
                                </div>
                                {selectedGdoId === gdo.id ? (
                                    <ChevronUp className="h-4 w-4 text-brand-orange" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-gray-400" />
                                )}
                            </button>
                        ))}
                        {gdoUsers.length === 0 && (
                            <div className="p-4 text-sm text-gray-400 text-center">Nessun GDO attivo</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right panel: Notes */}
            <div className="lg:col-span-2">
                {!selectedGdo ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                        <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">Seleziona un operatore GDO per visualizzare le note</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Header */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                            <div className="flex items-center justify-between flex-wrap gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-800">
                                        {selectedGdo.displayName || selectedGdo.name}
                                        {selectedGdo.gdoCode ? <span className="text-sm text-gray-400 ml-2">#{selectedGdo.gdoCode}</span> : null}
                                    </h2>
                                    <p className="text-sm text-gray-500">Livello {selectedGdo.level} &middot; {notes.length} note</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Filter */}
                                    <div className="flex items-center gap-1">
                                        <Filter className="h-4 w-4 text-gray-400" />
                                        <select
                                            value={filterCategory}
                                            onChange={e => setFilterCategory(e.target.value as GdoNoteCategory | "all")}
                                            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                                        >
                                            <option value="all">Tutte</option>
                                            {CATEGORIES.map(c => (
                                                <option key={c.value} value={c.value}>{c.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        onClick={() => setShowForm(!showForm)}
                                        className="flex items-center gap-1.5 bg-brand-orange text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-orange/90 transition-colors"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Nuova Nota
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Feedback */}
                        {feedback && (
                            <div className={`rounded-lg px-4 py-2 text-sm ${
                                feedback.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                            }`}>
                                {feedback.msg}
                            </div>
                        )}

                        {/* Add note form */}
                        {showForm && (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                                <form onSubmit={handleSubmit} className="space-y-3">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                                        <div className="flex flex-wrap gap-2">
                                            {CATEGORIES.map(c => (
                                                <button
                                                    key={c.value}
                                                    type="button"
                                                    onClick={() => setFormCategory(c.value)}
                                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                                        formCategory === c.value
                                                            ? c.color + " ring-2 ring-offset-1 ring-brand-orange"
                                                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                                    }`}
                                                >
                                                    {c.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Contenuto</label>
                                        <textarea
                                            value={formContent}
                                            onChange={e => setFormContent(e.target.value)}
                                            rows={3}
                                            placeholder="Scrivi la nota..."
                                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 resize-none"
                                        />
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { setShowForm(false); setFormContent(""); }}
                                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                                        >
                                            Annulla
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={saving || !formContent.trim()}
                                            className="px-4 py-1.5 bg-brand-orange text-white rounded-lg text-sm font-medium hover:bg-brand-orange/90 disabled:opacity-50 transition-colors"
                                        >
                                            {saving ? "Salvando..." : "Salva Nota"}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}

                        {/* Notes list */}
                        <div className="space-y-3">
                            {loadingNotes ? (
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-400">
                                    Caricamento note...
                                </div>
                            ) : filteredNotes.length === 0 ? (
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-400">
                                    {filterCategory !== "all"
                                        ? `Nessuna nota con categoria "${getCategoryLabel(filterCategory)}"`
                                        : "Nessuna nota per questo operatore"}
                                </div>
                            ) : (
                                filteredNotes.map(note => (
                                    <div key={note.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryStyle(note.category)}`}>
                                                        {getCategoryLabel(note.category)}
                                                    </span>
                                                    <span className="text-xs text-gray-400">
                                                        {new Date(note.createdAt).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                                                <p className="text-xs text-gray-400 mt-1.5">di {note.authorName ?? "Sconosciuto"}</p>
                                            </div>
                                            {note.authorUserId === currentUserId && (
                                                <button
                                                    onClick={() => handleDelete(note.id)}
                                                    className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                                                    title="Elimina nota"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
