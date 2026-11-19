<script lang="ts">
	import type { Profile } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		user: Profile;
		onClose: () => void;
		onUploaded: (avatarUrl: string) => void;
	}

	let { user, onClose, onUploaded }: Props = $props();

	const ALLOWED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

	let input: HTMLInputElement;
	let preview = $state<string | null>(null);
	let blob = $state<Blob | null>(null);
	let error = $state<string | null>(null);
	let uploading = $state(false);

	$effect(() => {
		const url = preview;
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	});

	async function cropSquare(file: File): Promise<Blob> {
		const bitmap = await createImageBitmap(file);
		const side = Math.min(bitmap.width, bitmap.height);
		const canvas = document.createElement("canvas");
		canvas.width = 256;
		canvas.height = 256;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Could not crop the image");
		context.drawImage(
			bitmap,
			(bitmap.width - side) / 2,
			(bitmap.height - side) / 2,
			side,
			side,
			0,
			0,
			256,
			256,
		);
		bitmap.close();
		const cropped = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/png"),
		);
		if (!cropped) throw new Error("Could not crop the image");
		return cropped;
	}

	async function choose(file: File | undefined) {
		if (!file) return;
		setError(null);
		if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
			error = "Choose a PNG, JPEG or WebP image.";
			return;
		}
		if (file.size > 2 * 1024 * 1024) {
			error = "The image must be 2 MB or smaller.";
			return;
		}
		try {
			const cropped = await cropSquare(file);
			if (preview) URL.revokeObjectURL(preview);
			preview = URL.createObjectURL(cropped);
			blob = cropped;
		} catch {
			error = "That file could not be read as an image.";
		}
	}

	async function upload() {
		if (!blob) return;
		uploading = true;
		setError(null);
		try {
			const body = new FormData();
			body.append("avatar", blob, "avatar.png");
			const result = await api<{ avatarUrl: string }>(
				`/api/users/${encodeURIComponent(user.username)}/avatar`,
				{ method: "POST", body },
			);
			onUploaded(result.avatarUrl);
		} catch (uploadError) {
			error =
				uploadError instanceof Error
					? uploadError.message
					: "Could not upload the avatar.";
		} finally {
			uploading = false;
		}
	}

	function setError(value: string | null) {
		error = value;
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		onclick={() => void upload()}
		isDisabled={!blob}
		isLoading={uploading}
	>
		Upload
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Change avatar" {onClose} {footer}>
	<div class="body">
		<div class="row">
			<div class="preview">
				{#if preview}
					<img src={preview} alt="Square avatar preview" />
				{:else}
					<div class="placeholder">Square crop preview</div>
				{/if}
			</div>
			<div>
				<Button onclick={() => input?.click()}>Choose image</Button>
				<input
					bind:this={input}
					type="file"
					accept="image/png,image/jpeg,image/webp"
					aria-label="Avatar image"
					onchange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						void choose(file);
					}}
					class="file"
				/>
				<p class="hint">
					PNG, JPEG or WebP up to 2 MB. The image is centre-cropped to a
					square.
				</p>
			</div>
		</div>
		{#if error}
			<p role="alert" class="error">{error}</p>
		{/if}
	</div>
</Modal>

<style>
	.body {
		display: grid;
		gap: 16px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 20px;
	}

	.preview {
		width: 160px;
		height: 160px;
		flex: none;
		overflow: hidden;
		border-radius: 3px;
		background-color: var(--ds-background-neutral);
		border: 1px solid var(--ds-border);
	}

	.preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.placeholder {
		display: flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
		color: var(--ds-text-subtle);
		font-size: 13px;
		text-align: center;
		padding: 16px;
	}

	.file {
		display: none;
	}

	.hint {
		margin: 8px 0 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.error {
		margin: 0;
		color: var(--ds-text-danger);
	}
</style>
