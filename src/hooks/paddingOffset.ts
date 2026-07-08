import {useEffect, useState} from "react";

export function usePaddingOffset(isMaximized: boolean) {
    const [offset, setOffset] = useState(0);

    const loadDefaultPadding = () => {
        setOffset(0);
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
