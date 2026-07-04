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
        const terminal: any = (this as any)._terminal;
        const element = terminal?.element as HTMLElement | undefined;
        const parent = element?.parentElement;
        if (!element || !parent) return;
        const dims = terminal._core?._renderService?.dimensions;
        if (!dims?.css?.cell?.width || !dims?.css?.cell?.height) return;

        const remainderH = parent.clientWidth - terminal.cols * dims.css.cell.width;
        const remainderV = parent.clientHeight - terminal.rows * dims.css.cell.height;
        element.style.marginLeft = `${Math.max(0, Math.floor(remainderH / 2))}px`;
        element.style.marginTop = `${Math.max(0, Math.floor(remainderV / 2))}px`;
    }
}
