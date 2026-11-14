do $$ declare j uuid:='00000000-0000-0000-0000-000000000002';a uuid:='00000000-0000-0000-0000-000000000001';r jsonb;begin
 if has_table_privilege('service_role','public.cs_venue_media_watermark_reviews','INSERT') or has_function_privilege('anon','public.cs_record_venue_watermark_review(uuid,timestamptz,text,text,text,text,uuid,timestamptz)','EXECUTE') then raise exception 'excessive grant';end if;
 r:=public.cs_record_venue_watermark_review(j,'2026-01-01',j::text||'.mp4',repeat('a',64),'pass','Full synthetic clip reviewed',a);
 if r is null or r->>'reviewer_id'<>a::text then raise exception 'valid review rejected';end if;
 if public.cs_record_venue_watermark_review(j,'2026-01-01',j::text||'.mp4',repeat('a',64),'fail','Stale overwrite',a) is not null then raise exception 'CAS bypass';end if;
 if public.cs_record_venue_watermark_review(j,'2026-01-02',j::text||'.mp4',repeat('b',64),'pass','Stale job revision',a) is not null then raise exception 'job CAS bypass';end if;
 if public.cs_record_venue_watermark_review(j,'2026-01-01','other.mp4',repeat('b',64),'pass','Wrong path',a) is not null then raise exception 'path bypass';end if;
 if public.cs_record_venue_watermark_review(j,'2026-01-01',j::text||'.mp4','a20bd6a7f813370991031840a105a6b3bbac66d28dddbe13dd6dedf920a4903d','pass','Known marked',a) is not null then raise exception 'marked bypass';end if;
 update auth.users set raw_app_meta_data='{}' where id=a;
 begin perform public.cs_record_venue_watermark_review(j,'2026-01-01',j::text||'.mp4',repeat('b',64),'pass','Revoked actor',a);raise exception 'revoked actor allowed';exception when others then if sqlerrm<>'Admin required' then raise;end if;end;
end $$;
