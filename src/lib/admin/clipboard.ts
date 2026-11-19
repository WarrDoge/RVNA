export async function copyToClipboard(value: string) {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		const area = document.createElement("textarea");
		area.value = value;
		document.body.appendChild(area);
		area.select();
		const copied = document.execCommand("copy");
		area.remove();
		return copied;
	}
}
