// Controls that intentionally keep a controlled `value`/`checked` without `bind:`.
// Each entry must say why hydration cannot wipe text the user typed: normally the
// control is rendered only after a dialog, popup, menu or inline edit opens on click.
export interface HydrationAllowListEntry {
	file: string;
	control: string;
	reason: string;
}

export const hydrationAllowList: HydrationAllowListEntry[] = [
	{
		file: "src/lib/admin/CopyPassword.svelte",
		control: 'input[aria-label="Generated password"] (value)',
		reason:
			"Read-only generated password inside the create-user/set-password dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/admin/DeleteDialog.svelte",
		control: 'select[id="migrate-target"] (value)',
		reason:
			"Delete-confirmation dialog, mounted only after the user clicks delete.",
	},
	{
		file: "src/lib/editor/wiki/MacroEditor.svelte",
		control: "input[type=checkbox] (checked)",
		reason:
			"Macro edit form, mounted only when the user clicks Edit on a macro.",
	},
	{
		file: "src/lib/editor/wiki/MacroEditor.svelte",
		control: "select (value)",
		reason:
			"Macro edit form, mounted only when the user clicks Edit on a macro.",
	},
	{
		file: "src/lib/editor/wiki/MacroEditor.svelte",
		control: "textarea (value)",
		reason:
			"Macro edit form, mounted only when the user clicks Edit on a macro.",
	},
	{
		file: "src/lib/editor/wiki/MacroEditor.svelte",
		control: "input[type=color] (value)",
		reason:
			"Macro edit form, mounted only when the user clicks Edit on a macro.",
	},
	{
		file: "src/lib/editor/wiki/MacroEditor.svelte",
		control: "input (value)",
		reason:
			"Macro edit form, mounted only when the user clicks Edit on a macro.",
	},
	{
		file: "src/lib/editor/wiki/MacroEditor.svelte",
		control: "input (value)",
		reason:
			"Macro edit form, mounted only when the user clicks Edit on a macro.",
	},
	{
		file: "src/lib/editor/wiki/MacroEditor.svelte",
		control: "textarea (value)",
		reason:
			"Macro edit form, mounted only when the user clicks Edit on a macro.",
	},
	{
		file: "src/lib/issue-form/DialogFooter.svelte",
		control: "input[type=checkbox] (checked)",
		reason:
			"Footer of the create/edit issue dialog, which opens only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/CascadingEditor.svelte",
		control: "select (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/CascadingEditor.svelte",
		control: "select (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/DateEditor.svelte",
		control: "input (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/LabelsEditor.svelte",
		control: "input (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/MultiSelectEditor.svelte",
		control: "input[type=checkbox] (checked)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/MultiUserEditor.svelte",
		control: "input (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/NumberEditor.svelte",
		control: "input[type=number] (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/TextEditor.svelte",
		control: "textarea (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/TextEditor.svelte",
		control: "input (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/editors/UrlEditor.svelte",
		control: "input (value)",
		reason:
			"Issue field editor inside the create/edit issue dialogs, which open only after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'select[aria-label="Project"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'select[aria-label="Issue Type"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'input[aria-label="Reporter"] (value)',
		reason:
			"Read-only reporter of the edit dialog, which opens after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'input[aria-label="Summary"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'select[aria-label="Priority"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'input[type=date][aria-label="Due date"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'input[type=number][aria-label="Story points"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'input[aria-label="Original estimate"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueFields.svelte",
		control: 'input[aria-label="Remaining estimate"] (value)',
		reason:
			"Issue form rendered only by CreateIssueDialog/EditIssueDialog, which open after a user action.",
	},
	{
		file: "src/lib/issue-form/IssueKeyPicker.svelte",
		control: "input (value)",
		reason:
			"Used by IssueFields, which is rendered only inside the create/edit issue dialogs.",
	},
	{
		file: "src/lib/issue-form/LabelInput.svelte",
		control: "input (value)",
		reason:
			"Used by IssueFields, which is rendered only inside the create/edit issue dialogs.",
	},
	{
		file: "src/lib/issue-form/MultiSelect.svelte",
		control: "input[type=checkbox] (checked)",
		reason:
			"Used by IssueFields, which is rendered only inside the create/edit issue dialogs.",
	},
	{
		file: "src/lib/issue-form/ResolutionDialog.svelte",
		control: "select (value)",
		reason: "Resolution dialog, opened by a user action.",
	},
	{
		file: "src/lib/issue/InlineSummary.svelte",
		control: 'input[aria-label="Summary"] (value)',
		reason:
			"Inline summary edit input, rendered only after the user clicks the summary.",
	},
	{
		file: "src/lib/issue/LinkDialog.svelte",
		control: 'select[aria-label="Link type"] (value)',
		reason: "Link dialog, opened by a user action.",
	},
	{
		file: "src/lib/issue/LinkDialog.svelte",
		control: 'select[aria-label="Direction"] (value)',
		reason: "Link dialog, opened by a user action.",
	},
	{
		file: "src/lib/issue/LinkDialog.svelte",
		control: 'input[id="link-target"] (value)',
		reason: "Link dialog, opened by a user action.",
	},
	{
		file: "src/lib/issue/LogWorkDialog.svelte",
		control: 'input[id="log-time"] (value)',
		reason: "Log-work dialog, opened by a user action.",
	},
	{
		file: "src/lib/issue/LogWorkDialog.svelte",
		control: 'input[type=datetime-local][id="log-started"] (value)',
		reason: "Log-work dialog, opened by a user action.",
	},
	{
		file: "src/lib/issue/LogWorkDialog.svelte",
		control: 'input[id="log-remaining"] (value)',
		reason: "Log-work dialog, opened by a user action.",
	},
	{
		file: "src/lib/issue/LogWorkDialog.svelte",
		control: 'textarea[id="log-comment"] (value)',
		reason: "Log-work dialog, opened by a user action.",
	},
	{
		file: "src/lib/jql/BasicMode.svelte",
		control: 'input[aria-label="Contains text"] (value)',
		reason:
			"Basic JQL editor, rendered only after the user switches from Advanced mode.",
	},
	{
		file: "src/lib/jql/Picker.svelte",
		control: "select (value)",
		reason:
			"JQL basic-mode control, rendered only after switching to Basic mode.",
	},
	{
		file: "src/lib/jql/RangePicker.svelte",
		control: "input[type=date] (value)",
		reason:
			"JQL basic-mode control, rendered only after switching to Basic mode.",
	},
	{
		file: "src/lib/jql/RangePicker.svelte",
		control: "input[type=date] (value)",
		reason:
			"JQL basic-mode control, rendered only after switching to Basic mode.",
	},
	{
		file: "src/lib/wiki/editor/EmojiPicker.svelte",
		control: 'input[aria-label="Search emoji"] (value)',
		reason: "Emoji popup, opened from the wiki editor toolbar.",
	},
	{
		file: "src/lib/wiki/editor/MacroField.svelte",
		control: "input[type=checkbox] (checked)",
		reason:
			"Macro parameter form inside the macro editor, which opens after a user action.",
	},
	{
		file: "src/lib/wiki/editor/MacroField.svelte",
		control: "select (value)",
		reason:
			"Macro parameter form inside the macro editor, which opens after a user action.",
	},
	{
		file: "src/lib/wiki/editor/MacroField.svelte",
		control: "textarea (value)",
		reason:
			"Macro parameter form inside the macro editor, which opens after a user action.",
	},
	{
		file: "src/lib/wiki/editor/MacroField.svelte",
		control: "input[type=color] (value)",
		reason:
			"Macro parameter form inside the macro editor, which opens after a user action.",
	},
	{
		file: "src/lib/wiki/editor/MacroField.svelte",
		control: "input (value)",
		reason:
			"Macro parameter form inside the macro editor, which opens after a user action.",
	},
	{
		file: "src/lib/wiki/editor/MacroField.svelte",
		control: "input (value)",
		reason:
			"Macro parameter form inside the macro editor, which opens after a user action.",
	},
	{
		file: "src/lib/wiki/editor/MovePageDialog.svelte",
		control: 'select[aria-label="After page"] (value)',
		reason:
			"Rendered only when the position 'after' is chosen, which takes effect after hydration.",
	},
	{
		file: "src/lib/wiki/editor/RestrictionsDialog.svelte",
		control: 'input[type=radio][name="restriction-mode"] (checked)',
		reason: "Restrictions dialog, opened by a user action.",
	},
	{
		file: "src/lib/wiki/editor/RestrictionsDialog.svelte",
		control: 'select[aria-label="Permission"] (value)',
		reason: "Restrictions dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/plugins/servlet/gitlab/+page.svelte",
		control: 'input[aria-label="Webhook URL"] (value)',
		reason:
			"Read-only webhook URL/secret; the user cannot type into it before hydration.",
	},
	{
		file: "src/routes/(admin)/plugins/servlet/gitlab/+page.svelte",
		control: 'input[aria-label="Webhook secret"] (value)',
		reason:
			"Read-only webhook URL/secret; the user cannot type into it before hydration.",
	},
	{
		file: "src/routes/(admin)/secure/admin/user/UserBrowser.jspa/CreateUserDialog.svelte",
		control: 'input[type=checkbox][name="generatePassword"] (checked)',
		reason: "Create-user dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/secure/admin/user/ViewUser.jspa/AddProjectRoleDialog.svelte",
		control: 'select[id="project-role-project"] (value)',
		reason: "Add-project-role dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/secure/admin/user/ViewUser.jspa/AddProjectRoleDialog.svelte",
		control: 'select[id="project-role-role"] (value)',
		reason: "Add-project-role dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/secure/admin/user/ViewUser.jspa/SetPasswordDialog.svelte",
		control: 'input[type=checkbox][name="generate"] (checked)',
		reason: "Set-password dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/secure/admin/ViewIssueTypes.jspa/+page.svelte",
		control: 'input[type=radio][name="issue-type-icon"] (value+checked)',
		reason:
			"Add/edit issue-type modal, rendered only after a user action (`formOpen`).",
	},
	{
		file: "src/routes/(admin)/secure/admin/ViewIssueTypes.jspa/+page.svelte",
		control: 'input[type=radio][name="issue-type-kind"] (checked)',
		reason:
			"Add/edit issue-type modal, rendered only after a user action (`formOpen`).",
	},
	{
		file: "src/routes/(admin)/secure/admin/ViewIssueTypes.jspa/+page.svelte",
		control: 'input[type=radio][name="issue-type-kind"] (checked)',
		reason:
			"Add/edit issue-type modal, rendered only after a user action (`formOpen`).",
	},
	{
		file: "src/routes/(admin)/secure/admin/workflows/ViewWorkflowSteps.jspa/PublishDialog.svelte",
		control: "select (value)",
		reason: "Publish-workflow dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/secure/project/ViewProjects.jspa/DeleteProjectDialog.svelte",
		control: 'input[name="confirmKey"] (value)',
		reason: "Delete-project confirmation dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/secure/project/ViewProjects.jspa/ProjectDialog.svelte",
		control: 'input[name="name"] (value)',
		reason: "Create/edit project dialog, opened by a user action.",
	},
	{
		file: "src/routes/(admin)/secure/project/ViewProjects.jspa/ProjectDialog.svelte",
		control: 'input[name="key"] (value)',
		reason: "Create/edit project dialog, opened by a user action.",
	},
	{
		file: "src/routes/boards/[rapidViewId]/plan/StartSprintDialog.svelte",
		control: 'select[aria-label="Sprint duration"] (value)',
		reason: "Start-sprint dialog, opened by a user action.",
	},
	{
		file: "src/routes/boards/[rapidViewId]/plan/StartSprintDialog.svelte",
		control: 'input[type=datetime-local][aria-label="Sprint start"] (value)',
		reason: "Start-sprint dialog, opened by a user action.",
	},
	{
		file: "src/routes/boards/[rapidViewId]/plan/StartSprintDialog.svelte",
		control: 'input[type=datetime-local][aria-label="Sprint end"] (value)',
		reason: "Start-sprint dialog, opened by a user action.",
	},
	{
		file: "src/routes/issues/ColumnsPicker.svelte",
		control: "input[type=checkbox] (checked)",
		reason: "Columns popup menu, opened by a user action.",
	},
	{
		file: "src/routes/issues/SaveAsDialog.svelte",
		control: 'input[name="name"] (value)',
		reason: "Save-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/issues/SaveAsDialog.svelte",
		control: 'textarea[name="description"] (value)',
		reason: "Save-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/issues/SaveAsDialog.svelte",
		control: 'input[type=checkbox][name="shared"] (checked)',
		reason: "Save-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/roles/AddRoleActorDialog.svelte",
		control: 'select[id="add-role"] (value)',
		reason: "Add-role-actor dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/roles/AddRoleActorDialog.svelte",
		control: 'input[id="add-actor-search"] (value)',
		reason: "Add-role-actor dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/summary/ComponentDialog.svelte",
		control: 'input[aria-label="Component name"] (value)',
		reason: "Component create/edit dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/summary/ComponentDialog.svelte",
		control: 'textarea[aria-label="Component description"] (value)',
		reason: "Component create/edit dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/summary/VersionDialog.svelte",
		control: 'input[aria-label="Version name"] (value)',
		reason: "Version create/edit dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/summary/VersionDialog.svelte",
		control: 'textarea[aria-label="Version description"] (value)',
		reason: "Version create/edit dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/summary/VersionDialog.svelte",
		control: 'input[type=date][aria-label="Start date"] (value)',
		reason: "Version create/edit dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/summary/VersionDialog.svelte",
		control: 'input[type=date][aria-label="Release date"] (value)',
		reason: "Version create/edit dialog, opened by a user action.",
	},
	{
		file: "src/routes/plugins/servlet/project-config/[key]/summary/VersionDialog.svelte",
		control: 'input[type=checkbox][name="released"] (checked)',
		reason: "Version create/edit dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/DashboardSettingsDialog.svelte",
		control: 'input[type=checkbox][name="shared"] (checked)',
		reason: "Dashboard settings dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'select[aria-label="Saved filter"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'select[aria-label="Project"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'select[aria-label="Statistic"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'select[aria-label="X axis"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'select[aria-label="Y axis"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: "input[type=checkbox] (checked)",
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'input[type=number][aria-label="Rows"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: "input[type=checkbox] (checked)",
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'input[aria-label="Projects"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'input[aria-label="Users"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'input[type=number][aria-label="Days"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'input[type=number][aria-label="Days"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: "input (value)",
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: "input (value)",
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/Dashboard.jspa/GadgetConfigDialog.svelte",
		control: 'input[type=number][aria-label="Auto refresh"] (value)',
		reason: "Gadget configuration dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageFilters.jspa/EditFilterDialog.svelte",
		control: 'input[name="name"] (value)',
		reason: "Edit-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageFilters.jspa/EditFilterDialog.svelte",
		control: 'textarea[name="description"] (value)',
		reason: "Edit-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageFilters.jspa/EditFilterDialog.svelte",
		control: 'input[type=checkbox][name="shared"] (checked)',
		reason: "Edit-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageFilters.jspa/EditFilterDialog.svelte",
		control: "input[type=checkbox] (value+checked)",
		reason: "Edit-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageFilters.jspa/EditFilterDialog.svelte",
		control: "input[type=checkbox] (value+checked)",
		reason: "Edit-filter dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageRapidViews.jspa/CreateBoardDialog.svelte",
		control: 'input[aria-label="Board name"] (value)',
		reason: "Create-board dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageRapidViews.jspa/CreateBoardDialog.svelte",
		control: 'select[aria-label="Board type"] (value)',
		reason: "Create-board dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageRapidViews.jspa/CreateBoardDialog.svelte",
		control: 'select[aria-label="Board project"] (value)',
		reason: "Create-board dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/ManageRapidViews.jspa/CreateBoardDialog.svelte",
		control: 'input[aria-label="Board filter"] (value)',
		reason: "Create-board dialog, opened by a user action.",
	},
	{
		file: "src/routes/secure/RapidView.jspa/GeneralForm.svelte",
		control: 'input[aria-label="Board project"] (value)',
		reason:
			"The board project name is read-only; the user cannot type into it before hydration.",
	},
];
