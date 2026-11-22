import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db.ts";
import { projects, projectWorkflows, workflowTransitions } from "../schema.ts";
import {
	gitlabProjectRepositories,
	gitlabProjectSettings,
	gitlabRepositories,
} from "../schema-gitlab.ts";

export interface ProjectGitlabSettingsBody {
	linkedRepositoryIds: string[];
	defaultRepositoryId: string | null;
	smartCommitsEnabled: boolean;
	mergeRequestOpenedEnabled: boolean;
	mergeRequestOpenedTransitions: string[];
	mergeRequestMergedEnabled: boolean;
	mergeRequestMergedTransitions: string[];
}

export async function projectByKey(key: string) {
	const [row] = await db
		.select({ id: projects.id, key: projects.key, name: projects.name })
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	return row ?? null;
}

export async function repositoriesForProject(projectId: string) {
	const rows = await db
		.select({
			id: gitlabRepositories.id,
			path: gitlabRepositories.path,
			webUrl: gitlabRepositories.webUrl,
			projectId: gitlabProjectRepositories.projectId,
		})
		.from(gitlabRepositories)
		.leftJoin(
			gitlabProjectRepositories,
			and(
				eq(gitlabProjectRepositories.repositoryId, gitlabRepositories.id),
				eq(gitlabProjectRepositories.projectId, projectId),
			),
		)
		.orderBy(gitlabRepositories.path);
	return rows.map((row) => ({
		id: row.id,
		path: row.path,
		webUrl: row.webUrl,
		linked: row.projectId !== null,
	}));
}

export async function availableTransitionNames(projectId: string) {
	const rows = await db
		.select({ name: workflowTransitions.name })
		.from(projectWorkflows)
		.innerJoin(
			workflowTransitions,
			eq(workflowTransitions.workflowId, projectWorkflows.workflowId),
		)
		.where(eq(projectWorkflows.projectId, projectId))
		.orderBy(workflowTransitions.sequence, workflowTransitions.name);
	return [...new Set(rows.map((row) => row.name))];
}

export async function projectGitlabSettings(projectId: string) {
	const [row] = await db
		.select()
		.from(gitlabProjectSettings)
		.where(eq(gitlabProjectSettings.projectId, projectId))
		.limit(1);
	const repositories = await repositoriesForProject(projectId);
	const linkedRepositoryIds = repositories
		.filter((repository) => repository.linked)
		.map((repository) => repository.id);
	return {
		repositories,
		linkedRepositoryIds,
		defaultRepositoryId:
			row?.defaultRepositoryId &&
			linkedRepositoryIds.includes(row.defaultRepositoryId)
				? row.defaultRepositoryId
				: (linkedRepositoryIds[0] ?? null),
		smartCommitsEnabled: row?.smartCommitsEnabled ?? false,
		mergeRequestOpenedEnabled: row?.mergeRequestOpenedEnabled ?? false,
		mergeRequestOpenedTransitions: stringList(
			row?.mergeRequestOpenedTransitions,
		),
		mergeRequestMergedEnabled: row?.mergeRequestMergedEnabled ?? false,
		mergeRequestMergedTransitions: stringList(
			row?.mergeRequestMergedTransitions,
		),
		availableTransitions: await availableTransitionNames(projectId),
	};
}

function stringList(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export async function saveProjectGitlabSettings(
	projectId: string,
	body: ProjectGitlabSettingsBody,
) {
	const requestedIds = [...new Set(body.linkedRepositoryIds)];
	const [known, availableTransitions] = await Promise.all([
		db
			.select({ id: gitlabRepositories.id })
			.from(gitlabRepositories)
			.where(inArray(gitlabRepositories.id, requestedIds)),
		availableTransitionNames(projectId),
	]);
	const knownIds = new Set(known.map((row) => row.id));
	const linked = requestedIds.filter((id) => knownIds.has(id));
	const defaultRepositoryId =
		body.defaultRepositoryId && linked.includes(body.defaultRepositoryId)
			? body.defaultRepositoryId
			: (linked[0] ?? null);
	const canonicalTransitions = new Map(
		availableTransitions.map((name) => [name.toLowerCase(), name]),
	);
	const transitions = (names: string[]) => {
		const result: string[] = [];
		for (const name of names) {
			const canonical = canonicalTransitions.get(name.toLowerCase());
			if (canonical && !result.includes(canonical)) result.push(canonical);
		}
		return result;
	};
	const settings = {
		defaultRepositoryId,
		smartCommitsEnabled: body.smartCommitsEnabled,
		mergeRequestOpenedEnabled: body.mergeRequestOpenedEnabled,
		mergeRequestOpenedTransitions: transitions(
			body.mergeRequestOpenedTransitions,
		),
		mergeRequestMergedEnabled: body.mergeRequestMergedEnabled,
		mergeRequestMergedTransitions: transitions(
			body.mergeRequestMergedTransitions,
		),
	};

	await db.transaction(async (tx) => {
		await tx
			.delete(gitlabProjectRepositories)
			.where(eq(gitlabProjectRepositories.projectId, projectId));
		if (linked.length > 0) {
			await tx
				.insert(gitlabProjectRepositories)
				.values(linked.map((repositoryId) => ({ projectId, repositoryId })));
		}
		await tx
			.insert(gitlabProjectSettings)
			.values({ projectId, ...settings })
			.onConflictDoUpdate({
				target: gitlabProjectSettings.projectId,
				set: { ...settings, updatedAt: new Date() },
			});
	});
}
