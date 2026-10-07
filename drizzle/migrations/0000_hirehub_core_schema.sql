CREATE TYPE public.user_role AS ENUM ('job_seeker','recruiter','admin');
CREATE TYPE public.company_status AS ENUM ('pending','approved');
CREATE TYPE public.job_type AS ENUM ('full_time','part_time','contract');
CREATE TYPE public.job_status AS ENUM ('pending','approved','closed');
CREATE TYPE public.application_status AS ENUM ('applied','shortlisted','interview','hired','rejected');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text NOT NULL,
  role public.user_role NOT NULL DEFAULT 'job_seeker',
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL, industry text, website text,
  status public.company_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL, description text, location text,
  job_type public.job_type NOT NULL DEFAULT 'full_time',
  salary_range text,
  status public.job_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  seeker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  resume_url text, cover_note text,
  status public.application_status NOT NULL DEFAULT 'applied',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, seeker_id)
);
CREATE TABLE public.saved_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seeker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seeker_id, job_id)
);

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies, public.jobs,
  public.applications, public.saved_jobs TO authenticated;
GRANT SELECT ON public.companies, public.jobs TO anon;
GRANT ALL ON public.profiles, public.companies, public.jobs,
  public.applications, public.saved_jobs TO service_role;

CREATE FUNCTION public.current_role_is(_r public.user_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = _r) $$;

CREATE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'job_seeker');
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE FUNCTION public.protect_profile_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role <> OLD.role AND NOT public.current_role_is('admin') THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_protect_role BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own or admin read profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.current_role_is('admin'));
CREATE POLICY "own or admin update profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.current_role_is('admin'));

CREATE POLICY "public reads approved companies" ON public.companies FOR SELECT TO anon, authenticated
  USING (status = 'approved' OR recruiter_id = auth.uid() OR public.current_role_is('admin'));
CREATE POLICY "recruiter creates own company" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (recruiter_id = auth.uid() AND public.current_role_is('recruiter') AND status = 'pending');
CREATE POLICY "owner or admin edits company" ON public.companies FOR UPDATE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));
CREATE POLICY "owner or admin deletes company" ON public.companies FOR DELETE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

CREATE POLICY "public reads approved jobs" ON public.jobs FOR SELECT TO anon, authenticated
  USING (status = 'approved' OR recruiter_id = auth.uid() OR public.current_role_is('admin'));
CREATE POLICY "recruiter posts job for own company" ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (recruiter_id = auth.uid() AND status = 'pending'
    AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = company_id AND c.recruiter_id = auth.uid()));
CREATE POLICY "owner or admin edits job" ON public.jobs FOR UPDATE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));
CREATE POLICY "owner or admin deletes job" ON public.jobs FOR DELETE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

CREATE POLICY "seeker, job owner or admin reads application" ON public.applications FOR SELECT TO authenticated
  USING (seeker_id = auth.uid() OR public.current_role_is('admin')
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.recruiter_id = auth.uid()));
CREATE POLICY "seeker applies to approved job" ON public.applications FOR INSERT TO authenticated
  WITH CHECK (seeker_id = auth.uid() AND status = 'applied' AND public.current_role_is('job_seeker')
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.status = 'approved'));
CREATE POLICY "job owner or admin updates status" ON public.applications FOR UPDATE TO authenticated
  USING (public.current_role_is('admin')
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.recruiter_id = auth.uid()));
CREATE POLICY "seeker withdraws own application" ON public.applications FOR DELETE TO authenticated
  USING (seeker_id = auth.uid());

CREATE POLICY "seeker manages own saved jobs" ON public.saved_jobs FOR ALL TO authenticated
  USING (seeker_id = auth.uid()) WITH CHECK (seeker_id = auth.uid());