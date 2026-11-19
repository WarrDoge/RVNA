import { token } from "#lib/tokens.ts";

export const inputStyle = `width: 100%; height: 32px; padding: 0 8px; background-color: ${token(
	"color.background.input",
)}; border: 1px solid ${token(
	"color.border.input",
)}; border-radius: 3px; color: ${token("color.text")}; font-size: 14px;`;

export const selectStyle = `${inputStyle} padding: 0 4px;`;

export const labelCellStyle = `padding-top: 7px; padding-right: 12px; text-align: right; color: ${token(
	"color.text.subtle",
)}; font-size: 14px; line-height: 18px;`;

export const hintStyle = `margin-top: 3px; color: ${token(
	"color.text.subtle",
)}; font-size: 12px; line-height: 16px;`;

export const linkButtonStyle = `margin-top: 4px; padding: 0; background: transparent; border: 0; color: ${token(
	"color.link",
)}; cursor: pointer; font-size: 12px;`;

export const chipStyle = `display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; border-radius: 3px; background-color: ${token(
	"color.background.neutral",
)}; color: ${token("color.text")}; font-size: 12px;`;

export const menuStyle = `position: absolute; top: 34px; left: 0; right: 0; z-index: 40; max-height: 240px; overflow-y: auto; padding: 4px; background-color: ${token(
	"elevation.surface.overlay",
)}; border: 1px solid ${token(
	"color.border",
)}; border-radius: 3px; box-shadow: ${token("elevation.shadow.overlay")};`;

export const menuItemStyle = `display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; background: transparent; border: 0; border-radius: 3px; color: ${token(
	"color.text",
)}; font-size: 14px; text-align: left; cursor: pointer;`;

export const errorStyle = `margin-top: 4px; font-size: 12px; color: ${token(
	"color.text.danger",
)};`;

export const noneStyle = `color: ${token("color.text.subtle")};`;

export const linkStyle = `color: ${token("color.link")}; text-decoration: none;`;

export const detailLabelStyle = `color: ${token(
	"color.text.subtle",
)}; font-size: 14px; line-height: 20px;`;

export const detailValueStyle = `min-width: 0; color: ${token(
	"color.text",
)}; font-size: 14px; line-height: 20px; overflow-wrap: anywhere;`;

export const inlineIconStyle =
	"display: inline-flex; align-items: center; gap: 6px;";

export const popupStyle = `position: absolute; top: 34px; left: 0; right: 0; z-index: 30; max-height: 220px; overflow-y: auto; padding: 4px; background-color: ${token(
	"elevation.surface.overlay",
)}; border: 1px solid ${token(
	"color.border",
)}; border-radius: 3px; box-shadow: ${token("elevation.shadow.overlay")};`;
