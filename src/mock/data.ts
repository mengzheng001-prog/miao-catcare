// 多宠物架构下，store 默认从空开始 —— 用户首次访问需要先在档案页创建宠物。
// 旧示例宠物数据已移除，避免对真实上传的 PDF 解析结果产生误导。
//
// 如需手动注入开发样例数据用于调试，可在浏览器 console 调用：
//   import { addPet, addSamplePdfForPet } from "../lib/store";
// 但生产 / 演示环境保持空白起步。

export const MOCK_PETS: any[] = [];
export const MOCK_PDFS: any[] = [];
export const MOCK_INDICATORS: any[] = [];
export const MOCK_MEDS: any[] = [];
export const MOCK_TIMELINE: any[] = [];
