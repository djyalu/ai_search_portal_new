import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const NotionService = {
    saveAnalysis: async (prompt, summary, results) => {
        if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
            throw new Error('Notion API configuration (NOTION_TOKEN or NOTION_DATABASE_ID) is missing in .env');
        }

        const blocks = [
            {
                object: 'block',
                type: 'heading_1',
                heading_1: { rich_text: [{ type: 'text', text: { content: 'AI 검색 분석 결과' } }] },
            },
            {
                object: 'block',
                type: 'heading_2',
                heading_2: { rich_text: [{ type: 'text', text: { content: '프롬프트' } }] },
            },
            {
                object: 'block',
                type: 'paragraph',
                paragraph: { rich_text: [{ type: 'text', text: { content: prompt } }] },
            },
            {
                object: 'block',
                type: 'heading_2',
                heading_2: { rich_text: [{ type: 'text', text: { content: '종합 요약' } }] },
            },
            {
                object: 'block',
                type: 'paragraph',
                paragraph: { rich_text: [{ type: 'text', text: { content: summary || '요약 결과가 없습니다.' } }] },
            },
            {
                object: 'block',
                type: 'divider',
                divider: {},
            },
            {
                object: 'block',
                type: 'heading_2',
                heading_2: { rich_text: [{ type: 'text', text: { content: 'AI별 상세 응답' } }] },
            },
        ];

        // 결과 추가
        Object.entries(results).forEach(([ai, content]) => {
            blocks.push({
                object: 'block',
                type: 'heading_3',
                heading_3: { rich_text: [{ type: 'text', text: { content: ai.toUpperCase() } }] },
            });

            const safeContent = typeof content === 'string' ? content : '데이터 없음';
            const chunkSize = 2000;

            for (let i = 0; i < safeContent.length; i += chunkSize) {
                const chunk = safeContent.substring(i, i + chunkSize);
                blocks.push({
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [{
                            type: 'text',
                            text: { content: chunk }
                        }]
                    },
                });
            }
        });

        try {
            const response = await notion.pages.create({
                parent: { database_id: process.env.NOTION_DATABASE_ID },
                properties: {
                    title: {
                        title: [
                            {
                                text: {
                                    content: `[AI 분석] ${prompt.substring(0, 50)}...`,
                                },
                            },
                        ],
                    },
                },
                children: blocks,
            });
            return response;
        } catch (error) {
            console.error('Notion API Error:', error);
            throw error;
        }
    }
};

export default NotionService;
