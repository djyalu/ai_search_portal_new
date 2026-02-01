/**
 * report_validator.js
 * Validates the generated markdown report against quality rules defined in REPORTING-UPGRADE-PLAN.md
 */

export const validateReport = (markdown, context = {}) => {
    const results = {
        score: 100,
        issues: [],
        passed: true
    };

    // 1. Check for basic headers
    const requiredheaders = [
        'Executive Summary',
        '핵심 인사이트',
        '인과관계',
        '시나리오 플래닝'
    ];

    requiredheaders.forEach(h => {
        if (!markdown.includes(h)) {
            results.score -= 10;
            results.issues.push(`Missing Required Section: ${h}`);
        }
    });

    // 2. Check for Tables
    const tableMatches = markdown.match(/\|.*\|/g);
    if (!tableMatches || tableMatches.length < 2) {
        results.score -= 20;
        results.issues.push("Insufficient Data Tables (expected at least 2 tables)");
    }

    // 3. Check for Numeric Hallucination indicators (Optional - like checking for "에이전트 단독 주장")
    // Simple check: if numbers exist, check for "추정" or "에이전트" nearby? (Too complex for simple regex)

    // 4. Check for length
    if (markdown.length < 1500) {
        results.score -= 15;
        results.issues.push("Report too short (under 1500 chars)");
    }

    if (results.score < 70) results.passed = false;

    return results;
};
