import {FitAddon} from "@xterm/addon-fit";

export class FloatingFitAddon extends FitAddon {
    public override proposeDimensions(): { cols: number; rows: number } | undefined {
        // @ts-ignore - FitAddon stores the activated terminal on a private field
        const terminal: any = (this as any)._terminal;
        if (!terminal || !terminal.element || !terminal.element.parentElement) {
            return undefined;
        }

        const core = terminal._core;
        const dims = core?._renderService?.dimensions;
        if (!dims || dims.css.cell.width === 0 || dims.css.cell.height === 0) {
            return undefined;
        }

        const parentElementStyle = window.getComputedStyle(terminal.element.parentElement);
        const parentElementHeight = parseInt(parentElementStyle.getPropertyValue("height"));
        const parentElementWidth = Math.max(0, parseInt(parentElementStyle.getPropertyValue("width")));
        const elementStyle = window.getComputedStyle(terminal.element);
        const elementPaddingHor =
            parseInt(elementStyle.getPropertyValue("padding-left")) +
            parseInt(elementStyle.getPropertyValue("padding-right"));
        const elementPaddingVer =
            parseInt(elementStyle.getPropertyValue("padding-top")) +
            parseInt(elementStyle.getPropertyValue("padding-bottom"));

        const availableHeight = parentElementHeight - elementPaddingVer;
        const availableWidth = parentElementWidth - elementPaddingHor;

        return {
            cols: Math.max(2, Math.floor(availableWidth / dims.css.cell.width)),
            rows: Math.max(1, Math.floor(availableHeight / dims.css.cell.height)),
        };
    }

    public override fit(): void {
        super.fit();
        // Anchor the terminal canvas to the top-left of the padding box instead
        // of centering the sub-cell remainder.
        //
        // Centering made the terminal's left/top edges jitter as the window was
        // resized: the remainder cycles through 0..cellWidth while cols/rows stay
        // constant, so marginLeft/Top swung by up to half a cell each step and the
        // whole render area appeared to jump around (especially the top-left).
        //
        // Anchoring top-left keeps the position stable across resizes. The
        // leftover sub-cell space (always < one cell) simply falls to the
        // right/bottom as background, so the configured left/right padding stays
        // fixed and consistent instead of being traded off against position.
        const terminal: any = (this as any)._terminal;
        const element = terminal?.element as HTMLElement | undefined;
        if (!element) return;
        element.style.marginLeft = "0px";
        element.style.marginTop = "0px";
    }
}
