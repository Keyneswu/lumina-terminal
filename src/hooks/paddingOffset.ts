import {useEffect, useState} from "react";
import {isMacOS} from "../lib/utils.ts";
import {getMaximized} from "./maximized.ts";

export function usePaddingOffset() {
    const isMaximized = getMaximized()
    const [offset, setOffset] = useState(0);

    const loadDefaultPadding = () => {
        if (isMacOS()) {
            setOffset(8);
        } else {
            setOffset(0);
        }
    }

    useEffect(() => {
        if (isMaximized) {
            setOffset(0);
        } else {
            loadDefaultPadding();
        }
    }, [isMaximized]);

    return offset;
}
