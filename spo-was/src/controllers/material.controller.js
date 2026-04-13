const materialService = require("../services/material.service");
const { createHandler } = require("./controller.helper");

const uploadMaterial = createHandler(materialService.uploadMaterial, {
  errorMessage: "자료 AI 처리 중 오류가 발생했습니다.",
});
const listMaterials = createHandler(materialService.listMaterials, {
  errorMessage: "자료 AI 처리 중 오류가 발생했습니다.",
});
const getMaterialDetail = createHandler(materialService.getMaterialDetail, {
  errorMessage: "자료 AI 처리 중 오류가 발생했습니다.",
});
const analyzeMaterial = createHandler(materialService.analyzeMaterial, {
  errorMessage: "자료 AI 처리 중 오류가 발생했습니다.",
});

module.exports = {
  uploadMaterial,
  listMaterials,
  getMaterialDetail,
  analyzeMaterial,
};
