import {useEffect, useState} from "react";
import {isMacOS} from "../lib/platform.ts";

export function usePaddingOffset(isMaximized: boolean) {
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
