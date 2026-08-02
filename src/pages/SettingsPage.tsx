import { useCallback, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import {
    Button,
    Modal,
} from "@heroui/react";
import {
    Plus,
    FileCog,
    Bug,
    Globe,
    Keyboard,
} from "lucide-react";
import { ITheme } from "@xterm/xterm";
import { useGlobalConfig } from "../hooks/config.tsx";
import { useI18n } from "../hooks/i18n.tsx";
import { TerminalProfile } from "../types/terminal.ts";
import { useSurfaceColors } from "../hooks/surfaceColors.ts";
import { useGlass } from "../hooks/useGlass.ts";
import { glassSurface } from "../lib/glass.ts";
import { whileHoverTap } from "../lib/motion.ts";
import { info, debug } from "@tauri-apps/plugin-log";
import ProfileSettings from "../components/settings/ProfileSettings.tsx";
import DeveloperSettings from "../components/settings/DeveloperSettings.tsx";
import GlobalProfileSettings from "../components/settings/GlobalProfileSettings.tsx";
import GeneralSettings from "../components/settings/GeneralSettings.tsx";
import AddProfileModal from "../components/settings/AddProfileModal.tsx";
import BindingsSettings from "../components/settings/BindingsSettings.tsx";

type SettingsSection = "general" | "globalProfile" | "bindings" | "developer" | string;

// Remember the last-viewed settings section across remounts (leaving the
// Settings tab and coming back). In-memory only — resets on app restart.
let lastSettingsSection: SettingsSection = "general";

function SidebarItem({
    children,
    isSelected,
    onClick,
    colors,
}: {
    children: React.ReactNode;
    isSelected: boolean;
    onClick: () => void;
    colors: { activeOverlay: string; hoverOverlay: string; accentOverlay: string };
}) {
    return (
        <motion.div
            {...whileHoverTap}
            className={`lum-settings-nav-item group relative flex items-center justify-between mx-2 px-3 py-2 my-0.5 cursor-pointer text-sm rounded-[var(--radius-sm)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-glass)] hover:bg-[var(--lum-nav-hover)] ${isSelected ? "bg-[var(--lum-nav-active)]" : ""}`}
            style={{
                "--lum-nav-hover": isSelected ? colors.accentOverlay : colors.hoverOverlay,
                "--lum-nav-active": colors.accentOverlay,
                fontWeight: isSelected ? 500 : 400,
            } as React.CSSProperties}
            onClick={onClick}
        >
            {children}
        </motion.div>
    );
}

export default function SettingsPage({ theme, openAbout }: { theme: ITheme | null, openAbout: () => void }) {
    const { config, updateConfig, newProfile } = useGlobalConfig();
    const t = useI18n();
    const [selectedSection, setSelectedSection] = useState<SettingsSection>(lastSettingsSection);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);

    const handleSectionChange = (section: SettingsSection) => {
        debug(`Settings section changed to: ${section}`);
        lastSettingsSection = section;
        setSelectedSection(section);
    };

    const bg = theme?.background ?? "#000000";
    const fg = theme?.foreground ?? "#ffffff";
    const colors = useSurfaceColors(bg);
    const {supportsGlass} = useGlass();
    const sidebarGlass = glassSurface(bg, supportsGlass, {blurPx: 16});

    const handleDeleteProfile = useCallback(
        (name: string) => {
            info(`Profile deleted: ${name}`);
            const newProfiles = config.profiles.filter((p) => p.name !== name);
            updateConfig({ profiles: newProfiles });
            if (selectedSection === name) {
                lastSettingsSection = "general";
                setSelectedSection("general");
            }
            setDeleteTarget(null);
        },
        [config.profiles, updateConfig, selectedSection]
    );

    const handleAddProfile = useCallback(() => {
        setShowAddModal(true);
    }, []);

    const createProfile = useCallback((profile: TerminalProfile) => {
        const baseName = profile.name || t["Untitled Profile"];
        let name = baseName;
        let i = 1;
        while (config.profiles.some((p) => p.name === name)) {
            name = `${baseName} ${i}`;
            i++;
        }
        const finalProfile = { ...profile, name };
        info(`Profile added: ${name}`);
        newProfile(finalProfile);
        lastSettingsSection = name;
        setSelectedSection(name);
        setShowAddModal(false);
    }, [config.profiles, newProfile, t]);

    return (
        <div className="flex flex-row h-full" style={{background: bg, color: fg}}>
            {/* Inner Sidebar — wears the glass material so the terminal canvas
                (or the page bg) shows through subtly, matching the terminal
                TabBar's treatment. */}
            <div
                className="flex flex-col shrink-0 h-full overflow-hidden"
                style={{
                    width: 180,
                    ...sidebarGlass,
                }}
            >
                <div className="flex-1 overflow-y-auto overflow-x-hidden pt-2">
                    {/* General */}
                    <SidebarItem
                        isSelected={selectedSection === "general"}
                        onClick={() => handleSectionChange("general")}
                        colors={colors}
                    >
                        <div className="flex items-center gap-2">
                            <FileCog size={15} />
                            <span className="truncate">{t["General"]}</span>
                        </div>
                    </SidebarItem>

                    {/* Global Profile */}
                    <SidebarItem
                        isSelected={selectedSection === "globalProfile"}
                        onClick={() => handleSectionChange("globalProfile")}
                        colors={colors}
                    >
                        <div className="flex items-center gap-2">
                            <Globe size={15} />
                            <span className="truncate">{t["Global Profile"]}</span>
                        </div>
                    </SidebarItem>

                    {/* Keyboard Shortcuts */}
                    <SidebarItem
                        isSelected={selectedSection === "bindings"}
                        onClick={() => handleSectionChange("bindings")}
                        colors={colors}
                    >
                        <div className="flex items-center gap-2">
                            <Keyboard size={15} />
                            <span className="truncate">{t["Keyboard Shortcuts"]}</span>
                        </div>
                    </SidebarItem>

                    <div className="mb-1" />

                    {/* Profiles header */}
                    <div className="flex items-center gap-2 px-3 pt-3 pb-1.5 select-none">
                        <span className="text-xs font-medium uppercase tracking-wider whitespace-nowrap" style={{color: colors.inactiveText, opacity: 0.8}}>
                            {t["Profiles"]}
                        </span>
                        <div className="flex-1" style={{borderTop: `1px solid ${colors.glassBorder}`}} />
                    </div>

                    {/* Profile list */}
                    {config.profiles.map((profile) => (
                        <SidebarItem
                            key={profile.name}
                            isSelected={selectedSection === profile.name}
                            onClick={() => handleSectionChange(profile.name)}
                            colors={colors}
                        >
                            <span className="truncate">{profile.name}</span>
                        </SidebarItem>
                    ))}
                    <div className="mb-1" />

                    {/* Developer header */}
                    <div className="flex items-center gap-2 px-3 pt-3 pb-1.5 select-none">
                        <span className="text-xs font-medium uppercase tracking-wider whitespace-nowrap" style={{color: colors.inactiveText, opacity: 0.8}}>
                            {t["Developer"]}
                        </span>
                        <div className="flex-1" style={{borderTop: `1px solid ${colors.glassBorder}`}} />
                    </div>

                    <SidebarItem
                        isSelected={selectedSection === "developer"}
                        onClick={() => handleSectionChange("developer")}
                        colors={colors}
                    >
                        <div className="flex items-center gap-2">
                            <Bug size={15} />
                            <span className="truncate">{t["Developer"]}</span>
                        </div>
                    </SidebarItem>
                </div>

                {/* Add Profile button */}
                <div className="shrink-0 p-2">
                    <motion.button
                        {...whileHoverTap}
                        className="flex flex-row items-center gap-2 w-full px-3 py-2.5 transition-colors duration-[var(--duration-fast)] cursor-pointer rounded-[var(--radius-sm)] hover:bg-[var(--lum-add-hover)]"
                        style={{
                            "--lum-add-hover": colors.hoverOverlay,
                            color: colors.inactiveText,
                        } as CSSProperties}
                        onClick={handleAddProfile}
                    >
                        <Plus size={16} />
                        <span className="text-sm">{t["Add Profile"]}</span>
                    </motion.button>
                </div>
            </div>

            {/* Content Area. Right padding is 0 so the inner scroll container's
                scrollbar sits flush at the window's right edge; each settings
                component re-adds right padding for its content/footer. */}
            <div className="flex-1 pt-6 pb-6 pl-6">
                {selectedSection === "general" ? (
                    <GeneralSettings borderColor={colors.borderColor} openAbout={openAbout} />
                ) : selectedSection === "globalProfile" ? (
                    <GlobalProfileSettings borderColor={colors.borderColor} />
                ) : selectedSection === "bindings" ? (
                    <BindingsSettings borderColor={colors.borderColor} />
                ) : selectedSection === "developer" ? (
                    <DeveloperSettings />
                ) : (
                    <ProfileSettings
                        profile={config.profiles.find((p) => p.name === selectedSection)}
                        onRequestDelete={() => setDeleteTarget(selectedSection)}
                        onNameChange={(newName) => handleSectionChange(newName)}
                        borderColor={colors.borderColor}
                    />
                )}
            </div>

            {/* Delete Confirmation Modal */}
            <Modal.Backdrop
                isOpen={deleteTarget !== null}
                onOpenChange={() => setDeleteTarget(null)}
                isDismissable
                variant="blur"
            >
                <Modal.Container placement="center">
                    <Modal.Dialog>
                        <Modal.Header>
                            <h3 className="text-lg font-semibold">{t["Delete Profile"]}</h3>
                            <p className="text-sm text-muted">
                                {t["Are you sure you want to delete this profile?"]}
                                <br />
                                <span className="text-danger text-sm">
                                    {t["This action cannot be undone."]}
                                </span>
                            </p>
                        </Modal.Header>
                        <Modal.Footer>
                            <Button variant="outline" onPress={() => setDeleteTarget(null)}>
                                {t["Cancel"]}
                            </Button>
                            <Button
                                variant="primary"
                                className="bg-danger text-danger-foreground"
                                onPress={() => {
                                    if (deleteTarget) {
                                        handleDeleteProfile(deleteTarget);
                                    }
                                }}
                            >
                                {t["Delete"]}
                            </Button>
                        </Modal.Footer>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>

            {/* Add Profile Modal */}
            <AddProfileModal
                isOpen={showAddModal}
                onOpenChange={setShowAddModal}
                onCreate={createProfile}
                borderColor={colors.borderColor}
            />
        </div>
    );
}
