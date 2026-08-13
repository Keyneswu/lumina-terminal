/**
 * Parse the "Technology Used" section of README.md into grouped tech items.
 *
 * Single source of truth: README.md is imported as a raw string and parsed
 * here, so the About page's tech list never drifts from the docs. The section
 * is located by a language-agnostic anchor — an HTML comment
 * `<!-- lumina:tech-stack -->` placed under the (localized) section heading —
 * so this parser works for every README translation without hardcoding any
 * heading text. Items may be grouped under `### Category` sub-headings; items
 * appearing before the first heading fall into a default "Other" group.
 */

export interface TechItem {
    name: string;
    url: string;
    /** Optional trailing description, e.g. "clap — CLI arg parsing". */
    description?: string;
}

export interface TechGroup {
    /** Raw README heading text, e.g. "Core". Resolve via {@link categoryLabel}. */
    category: string;
    items: TechItem[];
}

// Em-dash (U+2014) is what the README uses to separate the optional
// description from the link: `* [clap](url) — CLI arg parsing`.
const ITEM_REGEX = /^\*\s+\[(.+?)]\((.+?)\)(?:\s+\u2014\s+(.+))?$/;
const CATEGORY_REGEX = /^###\s+(.+?)\s*$/;
// Language-agnostic anchor: every localized README marks this section with an
// HTML comment that starts with `lumina:tech-stack` (e.g.
// `<!-- lumina:tech-stack — parsed by the About page -->`), placed right after
// its (localized) `##` heading. Parsing keys off the comment, not the heading
// text, so a new language needs no change here — just the same comment in its
// README. The comment is invisible when GitHub renders the markdown; any text
// after `lumina:tech-stack` is allowed as long as it stays on one line.
const MARKER_REGEX = /<!--\s*lumina:tech-stack\b.*-->/;
const NEXT_SECTION_REGEX = /^##\s/;
const DEFAULT_CATEGORY = "Other";

export function parseTechStack(readme: string): TechGroup[] {
    const lines = readme.split("\n");

    // Locate the anchor comment under the localized "Technology Used" heading.
    const startIdx = lines.findIndex((line) => MARKER_REGEX.test(line));
    if (startIdx === -1) return [];

    // Collect lines until the next top-level (## ) heading. A `### ` sub-heading
    // is NOT a top-level heading (^##\s requires the third char to be whitespace,
    // so "### Core" doesn't match) — exactly what lets sub-headings act as
    // category markers inside the section.
    const groups: TechGroup[] = [];
    const groupFor = (category: string): TechGroup => {
        let group = groups.find((g) => g.category === category);
        if (!group) {
            group = {category, items: []};
            groups.push(group);
        }
        return group;
    };

    let currentCategory = "";
    for (let i = startIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (NEXT_SECTION_REGEX.test(line)) break;

        const cat = line.match(CATEGORY_REGEX);
        if (cat) {
            currentCategory = cat[1].trim();
            continue;
        }

        const item = line.match(ITEM_REGEX);
        if (item) {
            const name = item[1];
            const url = item[2];
            const description = item[3]?.trim();
            groupFor(currentCategory || DEFAULT_CATEGORY).items.push(
                description ? {name, url, description} : {name, url},
            );
        }
    }

    return groups.filter((g) => g.items.length > 0);
}

/**
 * Resolve a README category heading (e.g. "Core") to a localized label via the
 * i18n table. Unknown categories fall back to their raw heading text, so a
 * newly added group still renders even before its translation key lands.
 */
export function categoryLabel(category: string, t: Record<string, string>): string {
    return t[category] || category;
}
