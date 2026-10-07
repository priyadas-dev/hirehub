CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r public.user_role := 'job_seeker';
BEGIN
  IF NEW.raw_user_meta_data->>'requested_role' = 'recruiter' THEN _r := 'recruiter'; END IF;
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), _r);
  RETURN NEW;
END $function$;