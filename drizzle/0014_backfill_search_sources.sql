ALTER TABLE "oidc_transactions" ADD COLUMN IF NOT EXISTS "client_ip" text;--> statement-breakpoint
ALTER TABLE "page_comments" ADD COLUMN IF NOT EXISTS "rendered_context" text;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN IF NOT EXISTS "rendered_context" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "rendered_context" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_transactions_created_at_idx" ON "oidc_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_transactions_client_ip_created_at_idx" ON "oidc_transactions" USING btree ("client_ip","created_at");--> statement-breakpoint
-- Rows written before the source columns were populated only have HTML. Turn
-- that HTML into the plain text the search vector and JQL text fields read.
UPDATE issues
SET description_source = nullif(
	btrim(
		regexp_replace(
			replace(
				replace(
					replace(
						replace(
							replace(
								replace(
									regexp_replace(description_html, '<[^>]*>', ' ', 'g'),
									'&nbsp;',
									' '
								),
								'&lt;',
								'<'
							),
							'&gt;',
							'>'
						),
						'&quot;',
						'"'
					),
					'&#39;',
					chr(39)
				),
				'&amp;',
				'&'
			),
			'\s+',
			' ',
			'g'
		)
	),
	''
)
WHERE description_source IS NULL AND description_html IS NOT NULL;
--> statement-breakpoint
UPDATE comments
SET body_source = nullif(
	btrim(
		regexp_replace(
			replace(
				replace(
					replace(
						replace(
							replace(
								replace(
									regexp_replace(body_html, '<[^>]*>', ' ', 'g'),
									'&nbsp;',
									' '
								),
								'&lt;',
								'<'
							),
							'&gt;',
							'>'
						),
						'&quot;',
						'"'
					),
					'&#39;',
					chr(39)
				),
				'&amp;',
				'&'
			),
			'\s+',
			' ',
			'g'
		)
	),
	''
)
WHERE body_source IS NULL AND body_html IS NOT NULL;
