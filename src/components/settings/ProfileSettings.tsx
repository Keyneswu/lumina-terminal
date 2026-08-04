import {SSHConfig, TerminalProfile} from "../../types/terminal.ts";
import {useGlobalConfig} from "../../hooks/config.tsx";
import {useI18n} from "../../hooks/i18n.tsx";
import {useEffect, useMemo, useRef, useState} from "react";
import {info} from "@tauri-apps/plugin-log";
import {open} from "@tauri-apps/plugin-dialog";
import {Button, Input, Label, ListBox, Select} from "@heroui/react";
import RenderSettings from "./RenderSettings.tsx";
import ShellSelector from "./ShellSelector.tsx";
import SshFields from "./SshFields.tsx";
import {Trash2, Pencil} from "lucide-react";
import SettingsShell from "../ui/SettingsShell.tsx";
import SettingRow from "../ui/SettingRow.tsx";
import SaveFooter from "../ui/SaveFooter.tsx";

export default function ProfileSettings({
    profile,
    onRequestDelete,
    onNameChange,
    borderColor,
}: {
    profile?: TerminalProfile;
    onRequestDelete: () => void;
    onNameChange: (newName: string) => void;
    borderColor: string;
}) {
    const {config, updateConfig} = useGlobalConfig();
    const t = useI18n();

    // Note: this panel keeps its own draft logic rather than using
    // useSettingsDraft. The draft is `TerminalProfile | null` (profile may be
    // undefined while the sidebar selection is in flight), and the save path
    // has profile-specific concerns (name-rename collision check, ssh field
    // pruning, onNameChange callback) that don't fit the generic hook's
    // single-commit signature. The visual shell/row/footer primitives are
    // still applied for consistency with the other panels.
    const [draft, setDraft] = useState<TerminalProfile | null>(null);

    // Reset draft when profile identity changes
    useEffect(() => {
        if (profile) {
            setDraft({...profile});
        } else {
            setDraft(null);
        }
    }, [profile?.name]);

    const isDirty = useMemo(() => {
        if (!profile || !draft) return false;
        return JSON.stringify(profile) !== JSON.stringify(draft);
    }, [profile, draft]);

    const updateDraft = (updates: Partial<TerminalProfile>) => {
        setDraft((prev) => (prev ? {...prev, ...updates} : null));
    };

    const updateSsh = (updates: Partial<SSHConfig>) => {
        setDraft((prev) => {
            if (!prev) return null;
            const ssh = {...prev.ssh, ...updates} as SSHConfig;
            return {...prev, ssh};
        });
    };

    const [isEditingName, setIsEditingName] = useState(false);
    const nameInputRef = useRef<HTMLInputElement>(null);

    // Auto-focus name input when entering edit mode
    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.select();
        }
    }, [isEditingName]);

    if (!profile || !draft) {
        return (
            <div className="flex items-center justify-center h-full text-muted text-sm">
                Profile not found.
            </div>
        );
    }

    const profileType = draft.type ?? "local";

    const handleSave = () => {
        if (!draft) return;
        const oldName = profile.name;
        info(`Profile saved: ${oldName}`);
        // Build trimmed profile — omitted undefined keys won't override globalProfile.
        const trimmed: TerminalProfile = JSON.parse(JSON.stringify({
            ...draft,
            name: draft.name.trim(),
            exePath: draft.exePath.trim(),
            fontFamily: draft.fontFamily?.trim() || undefined,
            fontStyle: draft.fontStyle || undefined,
            themePath: draft.themePath?.trim() || undefined,
            startupCommand: draft.startupCommand?.trim() || undefined,
            type: draft.type ?? "local",
            ssh: draft.type === "remote" ? draft.ssh : undefined,
        }));
        const newName = trimmed.name;
        if (!newName) return;

        // Check name collision (only if name changed and collides with another profile)
        if (newName !== oldName && config.profiles.some((p) => p.name === newName)) {
            return;
        }

        const newProfiles = config.profiles.map((p) =>
            p.name === oldName ? trimmed : p,
        );
        updateConfig({profiles: newProfiles});
        if (newName !== oldName) {
            onNameChange(newName);
        }
    };

    return (
        <SettingsShell
            footer={
                <SaveFooter
                    isDisabled={!isDirty}
                    saveLabel={t["Save"]}
                    onPressSave={handleSave}
                    isDirty={isDirty}
                    unsavedLabel={t["Unsaved changes"]}
                    borderColor={borderColor}
                    trailing={
                        <Button
                            variant="outline"
                            onPress={onRequestDelete}
                            className="text-danger border-danger/30 hover:bg-danger/10"
                        >
                            <Trash2 size={15} />
                            {t["Delete Profile"]}
                        </Button>
                    }
                />
            }
        >
            {isEditingName ? (
                <input
                    ref={nameInputRef}
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateDraft({name: e.target.value})}
                    onBlur={() => setIsEditingName(false)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") setIsEditingName(false);
                        if (e.key === "Escape") {
                            updateDraft({name: profile.name});
                            setIsEditingName(false);
                        }
                    }}
                    className="text-lg font-semibold mb-6 bg-transparent border-b outline-none w-full max-w-xs"
                    style={{borderColor, color: "inherit"}}
                />
            ) : (
                <h2
                    className="group lum-title-row flex items-center gap-2 text-lg font-semibold mb-6 cursor-pointer select-none"
                    onDoubleClick={() => setIsEditingName(true)}
                    title={t["Click the pencil or double-click to rename"]}
                >
                    <span className="truncate">{draft.name}</span>
                    <button
                        type="button"
                        // The edit button is the visible affordance for rename;
                        // double-click on the title still works for power users.
                        // Appears on hover (opacity-0 → group-hover:opacity-100).
                        className="lum-title-edit opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-glass)] p-1 rounded-[var(--radius-xs)] hover:bg-[var(--lum-title-hover)] cursor-pointer"
                        style={{"--lum-title-hover": "rgba(128,128,128,0.18)"} as React.CSSProperties}
                        onClick={() => setIsEditingName(true)}
                        aria-label={t["Rename"]}
                    >
                        <Pencil size={14} className="text-muted" />
                    </button>
                </h2>
            )}

            <div className="flex flex-col gap-4">
                {/* Profile Type */}
                <SettingRow label={<Label>{t["Profile Type"]}</Label>}>
                    <Select
                        selectedKey={profileType}
                        onSelectionChange={(key) => {
                            const newType = key as "local" | "remote";
                            updateDraft({
                                type: newType,
                                ssh: newType === "remote" ? (draft.ssh ?? {host: "", port: 22}) : undefined,
                            });
                        }}
                        className="max-w-sm"
                    >
                        <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                            <ListBox>
                                <ListBox.Item id="local" key="local" textValue="Local">
                                    {t["Local"]}
                                </ListBox.Item>
                                <ListBox.Item id="remote" key="remote" textValue="Remote (SSH)">
                                    {t["Remote (SSH)"]}
                                </ListBox.Item>
                            </ListBox>
                        </Select.Popover>
                    </Select>
                </SettingRow>

                {/* Exe Path (only for local) */}
                {profileType === "local" && (
                    <ShellSelector
                        exePath={draft.exePath}
                        onChange={(path) => updateDraft({exePath: path})}
                        idPrefix="profile"
                    />
                )}

                {/* Startup Directory */}
                <SettingRow label={<Label htmlFor="profile-cwd">{t["Startup Directory"]}</Label>}>
                    <div className="flex flex-row gap-2 items-center">
                        <Input
                            id="profile-cwd"
                            value={draft.cwd ?? ""}
                            onChange={(e) => updateDraft({cwd: e.target.value || undefined})}
                            className="flex-1 max-w-sm"
                            placeholder={t["Default"]}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onPress={async () => {
                                const dir = await open({
                                    multiple: false,
                                    directory: true,
                                });
                                if (dir) updateDraft({cwd: dir});
                            }}
                        >
                            {t["Select"]}
                        </Button>
                    </div>
                </SettingRow>

                {/* Startup Command */}
                <SettingRow label={<Label htmlFor="profile-startup-command">{t["Startup Command"]}</Label>}>
                    <Input
                        id="profile-startup-command"
                        value={draft.startupCommand ?? ""}
                        onChange={(e) => updateDraft({startupCommand: e.target.value || undefined})}
                        className="max-w-sm"
                        placeholder={profileType === "remote" ? "e.g. top" : "e.g. vim, opencode"}
                    />
                </SettingRow>

                {/* SSH Config Fields */}
                {profileType === "remote" && (
                    <SshFields
                        ssh={draft.ssh}
                        onChange={updateSsh}
                        idPrefix="ssh"
                    />
                )}

                <RenderSettings draft={draft} updateDraft={updateDraft} idPrefix="profile" defaultExpanded={false} />
            </div>
        </SettingsShell>
    );
}
