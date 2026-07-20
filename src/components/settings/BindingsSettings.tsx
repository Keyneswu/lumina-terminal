import {useCallback, useEffect, useMemo, useState} from "react";
import {Button, Kbd, Label, ListBox, Select} from "@heroui/react";
import {Pencil, Plus, RotateCcw, Trash2, X} from "lucide-react";
import {useGlobalConfig} from "../../hooks/config.tsx";
import {useI18n} from "../../hooks/i18n.tsx";
import {info} from "@tauri-apps/plugin-log";
import {Actions, Binding, WithKeys} from "../../types/config.ts";
import {DEFAULT_BINDINGS} from "../../constants.ts";
import {actionSignature, bindingToShortcut, keySignature} from "../../lib/bindings.ts";

// Key used in the "Add binding" action dropdown when no action is chosen yet.
const NO_ACTION = "__none__";
// Sentinel used in the profile picker to mean "the default profile".
const DEFAULT_PROFILE_KEY = "__default_profile__";

// All actions a user can bind.
// Note: newTab opens a terminal profile. No args → default profile;
// args.profileName → a specific profile. openConfigFile (opens config.json)
// is intentionally excluded from the bindings UI.
const ALL_ACTIONS: Actions[] = [
    "newTab",
    "closeTab",
    "openSettings",
    "openCommandPalette",
    "toggleSidebar",
    "toTab",
];

type TranslationDict = ReturnType<typeof useI18n>;

function actionLabel(action: Actions, args: Record<string, string> | undefined, t: TranslationDict, preview?: boolean): string {
    switch (action) {
        case "newTab": {
            const name = args?.profileName;
            if (name) return `${t["Open Profile"]}: ${name}`;
            if (preview) {
                return t["Open Profile"];
            } else {
                return `${t["Open Profile"]}: ${t["Default"]}`;
            }
        }
        case "closeTab":
            return t["Close Tab"];
        case "openSettings":
            return t["Settings"];
        case "openCommandPalette":
            return t["Open Command Palette"];
        case "toggleSidebar":
            return t["Toggle Sidebar"];
        case "openConfigFile":
            return t["Open Config File"];
        case "toTab": {
            const idx = args?.index;
            if (idx === "last") return `${t["Switch to Tab"]}: ${t["Last tab"]}`;
            if (idx !== undefined && /^\d+$/.test(idx)) {
                return `${t["Switch to Tab"]}: ${t["Tab {n}"].replace("{n}", String(+idx + 1))}`;
            }
            return `${t["Switch to Tab"]}: ${idx ?? ""}`;
        }
    }
}

// An action signature (action + args) — used to detect default bindings so that
// "delete" can restore the default instead of removing the row entirely.
// actionSignature and keySignature are imported from lib/bindings.ts so the
// settings UI and the runtime matcher stay perfectly in sync.
const DEFAULT_SIGNATURES = new Set(DEFAULT_BINDINGS.map(actionSignature));

function isDefaultBinding(b: Binding): boolean {
    return DEFAULT_SIGNATURES.has(actionSignature(b));
}

function findDefaultFor(b: Binding): Binding | undefined {
    const sig = actionSignature(b);
    return DEFAULT_BINDINGS.find((d) => actionSignature(d) === sig);
}

export default function BindingsSettings({borderColor}: { borderColor: string }) {
    const {config, updateConfig} = useGlobalConfig();
    const t = useI18n();

    const sourceBindings = config.bindings?.length ? config.bindings : DEFAULT_BINDINGS;

    const [draft, setDraft] = useState<Binding[]>(() => sourceBindings.map((b) => ({...b})));
    const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
    // New-binding creation state.
    const [newAction, setNewAction] = useState<Actions | typeof NO_ACTION>(NO_ACTION);
    const [newTabIndex, setNewTabIndex] = useState<string>("0");
    // For newTab: DEFAULT_PROFILE_KEY = default profile; otherwise the profile name to open.
    const [newProfileName, setNewProfileName] = useState<string>(DEFAULT_PROFILE_KEY);

    // Reset draft when config changes externally.
    useEffect(() => {
        const src = config.bindings?.length ? config.bindings : DEFAULT_BINDINGS;
        setDraft(src.map((b) => ({...b})));
    }, [config.bindings]);

    const isDirty = useMemo(() => {
        return JSON.stringify(draft) !== JSON.stringify(sourceBindings.map((b) => ({...b})));
    }, [draft, sourceBindings]);

    // Conflict detection: any key signature appearing more than once.
    const conflicts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const b of draft) {
            const sig = keySignature(b.key, b.with);
            counts.set(sig, (counts.get(sig) ?? 0) + 1);
        }
        const set = new Set<number>();
        draft.forEach((b, i) => {
            if ((counts.get(keySignature(b.key, b.with)) ?? 0) > 1) set.add(i);
        });
        return set;
    }, [draft]);

    const hasConflicts = conflicts.size > 0;

    // Every binding must have a key AND at least one accelerator (modifier).
    const missingAccelerator = useMemo(() => {
        const set = new Set<number>();
        draft.forEach((b, i) => {
            if (b.key.trim().length === 0 || b.with.length === 0) set.add(i);
        });
        return set;
    }, [draft]);

    const hasMissingAccelerator = missingAccelerator.size > 0;

    const updateBinding = useCallback((index: number, updates: Partial<Binding>) => {
        setDraft((prev) => prev.map((b, i) => (i === index ? {...b, ...updates} : b)));
    }, []);

    const stopRecording = useCallback(() => setRecordingIndex(null), []);

    // Key recorder: while recordingIndex is set, capture the next keydown globally.
    useEffect(() => {
        if (recordingIndex === null) return;
        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Esc always cancels recording.
            if (e.key === "Escape") {
                stopRecording();
                return;
            }
            // Ignore pure modifier presses (don't commit until a real key is pressed).
            if (["Control", "Shift", "Alt", "Meta", "ContextMenu"].includes(e.key)) return;

            const withKeys: WithKeys[] = [];
            if (e.metaKey) withKeys.push("command");
            if (e.ctrlKey) withKeys.push("ctrl");
            if (e.altKey) withKeys.push("alt");
            // For a single-letter key, Shift is reflected in e.key (uppercase). We store the
            // lowercase key + an explicit "shift" modifier so bindingToShortcut / matchBinding
            // (which compare case-insensitively for length-1 keys and check shiftKey) stay
            // consistent with the existing default convention (e.g. openCommandPalette).
            const isLetter = e.key.length === 1 && /[a-zA-Z]/.test(e.key);
            if (e.shiftKey) withKeys.push("shift");

            // A binding must include at least one accelerator (modifier). If the user pressed a
            // bare key with no modifier, stay in recording mode and let them try again.
            if (withKeys.length === 0) return;

            let key = e.key;
            if (isLetter) key = e.key.toLowerCase();

            if (recordingIndex !== null) {
                updateBinding(recordingIndex, {key, with: withKeys});
            }
            stopRecording();
        };
        window.addEventListener("keydown", handler, {capture: true});
        return () => window.removeEventListener("keydown", handler, {capture: true});
    }, [recordingIndex, updateBinding, stopRecording]);

    const handleDelete = useCallback((index: number) => {
        setDraft((prev) => {
            const target = prev[index];
            if (!target) return prev;
            // Deleting a default action restores the default key rather than removing the row.
            if (isDefaultBinding(target)) {
                const def = findDefaultFor(target);
                if (def) {
                    return prev.map((b, i) => (i === index ? {...def} : b));
                }
            }
            return prev.filter((_, i) => i !== index);
        });
    }, []);

    const handleAdd = useCallback(() => {
        if (newAction === NO_ACTION) return;
        const action = newAction as Actions;
        let args: Record<string, string> | undefined;
        if (action === "toTab") {
            args = {index: newTabIndex};
        } else if (action === "newTab" && newProfileName && newProfileName !== DEFAULT_PROFILE_KEY) {
            args = {profileName: newProfileName};
        }
        const candidate: Binding = {
            key: "",
            with: [],
            action,
            args,
        };
        setDraft((prev) => [...prev, candidate]);
        setNewAction(NO_ACTION);
        setNewTabIndex("0");
        setNewProfileName(DEFAULT_PROFILE_KEY);
        // Start recording for the newly added binding.
        setRecordingIndex(-1); // temporary; will be patched once state settles
    }, [newAction, newTabIndex, newProfileName]);

    // After adding, recordingIndex is -1 (sentinel). Resolve to the last index once.
    useEffect(() => {
        if (recordingIndex === -1) {
            setRecordingIndex(draft.length - 1);
        }
    }, [recordingIndex, draft.length]);

    const handleReset = useCallback(() => {
        setDraft(DEFAULT_BINDINGS.map((b) => ({...b})));
        setRecordingIndex(null);
    }, []);

    const handleSave = useCallback(() => {
        if (hasConflicts || hasMissingAccelerator) return;
        info(`Bindings saved (${draft.length} entries)`);
        updateConfig({bindings: draft.map((b) => ({...b}))});
    }, [draft, hasConflicts, hasMissingAccelerator, updateConfig]);

    const dangerColor = "var(--color-danger-500, #ef4444)";

    return (
        <div className="flex flex-col h-full">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto pb-4 pl-1 pr-6 w-full">
                <h2 className="text-lg font-semibold mb-2">{t["Keyboard Shortcuts"]}</h2>
                <p className="text-xs text-muted mb-5">
                    {t["Click a shortcut and press the keys you want to use."]}
                </p>

                <div className="flex flex-col gap-2">
                    {draft.map((b, i) => {
                        const isRecording = recordingIndex === i;
                        const hasConflict = conflicts.has(i);
                        const isIncomplete = b.key.trim().length === 0 || b.with.length === 0;
                        const isInvalid = hasConflict || isIncomplete;
                        const shortcut = bindingToShortcut(b);

                        return (
                            <div
                                key={`${b.action}-${i}`}
                                className="flex flex-row items-center gap-3 px-3 py-2.5 rounded-md"
                                style={{
                                    border: `1px solid ${isInvalid ? dangerColor : borderColor}`,
                                    background: isInvalid ? "rgba(239,68,68,0.06)" : "transparent",
                                }}
                            >
                                {/* Action label */}
                                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                    <span className="text-sm font-medium truncate">
                                        {actionLabel(b.action, b.args, t)}
                                    </span>
                                    {hasConflict && (
                                        <span className="text-xs" style={{color: dangerColor}}>
                                            {t["Conflict: this shortcut is already in use"]}
                                        </span>
                                    )}
                                    {isIncomplete && !isRecording && (
                                        <span className="text-xs" style={{color: dangerColor}}>
                                            {b.with.length === 0
                                                ? t["At least one modifier key is required"]
                                                : t["Press keys to record..."]}
                                        </span>
                                    )}
                                </div>

                                {/* Shortcut display / recorder */}
                                {isRecording ? (
                                    <div
                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm select-none"
                                        style={{
                                            border: `1px solid ${borderColor}`,
                                            background: "var(--color-default-100, transparent)",
                                            minWidth: 140,
                                            justifyContent: "space-between",
                                        }}
                                    >
                                        <span className="text-muted">{t["Recording... Esc to cancel"]}</span>
                                        <button
                                            onClick={stopRecording}
                                            className="cursor-pointer text-muted hover:text-foreground shrink-0"
                                            title={t["Cancel"]}
                                        >
                                            <X size={14}/>
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-md cursor-pointer shrink-0 hover:bg-[var(--color-default-100,rgba(125,125,125,0.1))]"
                                        style={{border: `1px solid ${borderColor}`}}
                                        onClick={() => setRecordingIndex(i)}
                                        title={t["Press keys to record..."]}
                                    >
                                        {b.key.trim().length > 0 ? (
                                            shortcut.map((key, j) => (
                                                <Kbd key={j}>
                                                    {key.abbr ? (
                                                        // @ts-ignore — keyValue is not typed in heroui
                                                        <Kbd.Abbr keyValue={key.abbr}/>
                                                    ) : null}
                                                    <Kbd.Content>{key.content}</Kbd.Content>
                                                </Kbd>
                                            ))
                                        ) : (
                                            <Pencil size={14} className="text-muted"/>
                                        )}
                                    </button>
                                )}

                                {/* Edit + delete / restore */}
                                {!isRecording && (
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            className="cursor-pointer p-1.5 rounded-md hover:bg-[var(--color-default-100,rgba(125,125,125,0.1))] text-muted"
                                            onClick={() => setRecordingIndex(i)}
                                            title={t["Press keys to record..."]}
                                        >
                                            <Pencil size={15}/>
                                        </button>
                                        <button
                                            className="cursor-pointer p-1.5 rounded-md hover:bg-[var(--color-default-100,rgba(125,125,125,0.1))] text-muted"
                                            onClick={() => handleDelete(i)}
                                            title={isDefaultBinding(b) ? t["Restore default"] : t["Delete"]}
                                        >
                                            {isDefaultBinding(b) ? (
                                                <RotateCcw size={15}/>
                                            ) : (
                                                <Trash2 size={15}/>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Add binding row */}
                <div
                    className="flex flex-row items-end gap-3 mt-5 pt-4 px-3"
                    style={{borderTop: `1px solid ${borderColor}`}}
                >
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0 max-w-xs">
                        <Label>{t["Action"]}</Label>
                        <Select
                            selectedKey={newAction}
                            onSelectionChange={(key) => {
                                if (key) setNewAction(key as Actions);
                            }}
                        >
                            <Select.Trigger>
                                <Select.Value/>
                                <Select.Indicator/>
                            </Select.Trigger>
                            <Select.Popover>
                                <ListBox>
                                    {ALL_ACTIONS.map((a) => (
                                        <ListBox.Item id={a} key={a} textValue={a}>
                                            {actionLabel(a, undefined, t, true)}
                                        </ListBox.Item>
                                    ))}
                                </ListBox>
                            </Select.Popover>
                        </Select>
                    </div>

                    {newAction === "toTab" && (
                        <div className="flex flex-col gap-1.5 w-28">
                            <Label>{t["Switch to Tab"]}</Label>
                            <Select
                                selectedKey={newTabIndex}
                                onSelectionChange={(key) => {
                                    if (key) setNewTabIndex(key as string);
                                }}
                            >
                                <Select.Trigger>
                                    <Select.Value/>
                                    <Select.Indicator/>
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        {["0", "1", "2", "3", "4", "5", "6", "7"].map((idx) => (
                                            <ListBox.Item id={idx} key={idx} textValue={idx}>
                                                {t["Tab {n}"].replace("{n}", String(+idx + 1))}
                                            </ListBox.Item>
                                        ))}
                                        <ListBox.Item id="last" key="last" textValue="last">
                                            {t["Last tab"]}
                                        </ListBox.Item>
                                    </ListBox>
                                </Select.Popover>
                            </Select>
                        </div>
                    )}

                    {newAction === "newTab" && (
                        <div className="flex flex-col gap-1.5 w-44">
                            <Label>{t["Profile"]}</Label>
                            <Select
                                selectedKey={newProfileName}
                                onSelectionChange={(key) => {
                                    if (key) setNewProfileName(key as string);
                                }}
                            >
                                <Select.Trigger>
                                    <Select.Value/>
                                    <Select.Indicator/>
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        <ListBox.Item id={DEFAULT_PROFILE_KEY} key={DEFAULT_PROFILE_KEY} textValue={DEFAULT_PROFILE_KEY}>
                                            {t["Default Profile"]}
                                        </ListBox.Item>
                                        {config.profiles.map((p) => (
                                            <ListBox.Item id={p.name} key={p.name} textValue={p.name}>
                                                {p.name}
                                            </ListBox.Item>
                                        ))}
                                    </ListBox>
                                </Select.Popover>
                            </Select>
                        </div>
                    )}

                    <Button
                        variant="outline"
                        isDisabled={newAction === NO_ACTION}
                        onPress={handleAdd}
                    >
                        <Plus size={15}/>
                        {t["Add Binding"]}
                    </Button>
                </div>
            </div>

            {/* Fixed footer: Save + Reset */}
            <div className="shrink-0 border-t pt-3 pr-6" style={{borderColor}}>
                <div className="flex items-center gap-3 justify-between">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="primary"
                            isDisabled={!isDirty || hasConflicts || hasMissingAccelerator}
                            onPress={handleSave}
                        >
                            {t["Save"]}
                        </Button>
                        {isDirty && !hasConflicts && !hasMissingAccelerator && (
                            <span className="text-xs text-muted">{t["Unsaved changes"]}</span>
                        )}
                        {hasConflicts && (
                            <span className="text-xs" style={{color: dangerColor}}>
                                {t["Conflict: this shortcut is already in use"]}
                            </span>
                        )}
                        {!hasConflicts && hasMissingAccelerator && (
                            <span className="text-xs" style={{color: dangerColor}}>
                                {t["At least one modifier key is required"]}
                            </span>
                        )}
                    </div>
                    <Button variant="outline" onPress={handleReset}>
                        <RotateCcw size={15}/>
                        {t["Reset to Defaults"]}
                    </Button>
                </div>
            </div>
        </div>
    );
}
