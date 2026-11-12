use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

#[derive(Clone, Debug)]
struct QueryDef {
    id: String,
    label: String,
    category: String,
    module: String,
    priority: String,
    template: String,
    description: String,
    explanation: String,
    engines_note: String,
    global: bool,
    operators: Vec<String>,
}

fn main() {
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    let target = jstr(&input, "target").unwrap_or_else(|| "example.com".to_string());
    let scope = jstr(&input, "scope").unwrap_or_else(|| "root".to_string());
    let modules = jarr_str(&input, "modules");

    let (ok, norm, scope_label, err) = normalize_target(&target, &scope);
    if !ok {
        print!("{{\"ok\":false,\"error\":\"{}\"}}", esc(&err));
        return;
    }

    let defs = load_queries();
    if defs.is_empty() {
        print!("{{\"ok\":false,\"error\":\"data.json not found or no queries loaded\"}}");
        return;
    }

    let modset: HashSet<String> = modules.into_iter().collect();
    let mut seen: HashMap<String, (i32, String)> = HashMap::new(); // key -> (rank, json)

    for d in defs.iter() {
        if !modset.is_empty() && !modset.contains(&d.module) { continue; }
        let mut qs = d.template.replace("{target}", &norm);
        if !d.global && scope == "root_sub" && normalize_ws(&d.template) == "site:{target}" {
            qs = format!("(site:{} OR site:*.{})", norm, norm);
        }
        qs = normalize_ws(&qs);
        if !validate_q(&qs) { continue; }
        let key = qs.to_lowercase();
        let pri = if d.priority.is_empty() { "informational".to_string() } else { d.priority.clone() };
        let r = rank(&pri);
        let ops = if d.operators.is_empty() { detect_ops(&qs) } else { d.operators.clone() };
        let en = if d.engines_note.is_empty() { "Varies by engine.".to_string() } else { d.engines_note.clone() };
        let qjson = format!(
            "{{\"id\":\"{}_rust\",\"key\":\"{}\",\"label\":\"{}\",\"category\":\"{}\",\"module\":\"{}\",\"priority\":\"{}\",\"query\":\"{}\",\"description\":\"{}\",\"explanation\":\"{}\",\"operators\":{},\"enginesNote\":\"{}\",\"global\":{},\"source\":\"preset\",\"status\":\"Not Reviewed\",\"saved\":false,\"selected\":true,\"notes\":\"\",\"tags\":[]}}",
            esc(&d.id), esc(&key), esc(&d.label), esc(&d.category), esc(&d.module), esc(&pri), esc(&qs), esc(&d.description), esc(&d.explanation), str_arr(&ops), esc(&en), if d.global {"true"} else {"false"}
        );
        match seen.get(&key) {
            Some((pr, _)) if *pr >= r => {}
            _ => { seen.insert(key, (r, qjson)); }
        }
    }

    let mut items: Vec<(String,String)> = seen.into_iter().map(|(k,v)| (k, v.1)).collect();
    items.sort_by(|a,b| a.0.cmp(&b.0));
    let queries_json = items.into_iter().map(|x| x.1).collect::<Vec<_>>().join(",");
    print!(
        "{{\"ok\":true,\"engine_used\":\"rust\",\"target\":{{\"ok\":true,\"normalized\":\"{}\",\"scope\":\"{}\",\"scopeLabel\":\"{}\"}},\"count\":{},\"queries\":[{}]}}",
        esc(&norm), esc(&scope), esc(&scope_label), queries_json.matches("\"id\":").count(), queries_json
    );
}

fn load_queries() -> Vec<QueryDef> {
    let mut candidates: Vec<PathBuf> = vec!["data.json".into(), "../data.json".into()];
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("data.json"));
            candidates.push(dir.join("../data.json"));
        }
    }
    for p in candidates {
        if let Ok(s) = fs::read_to_string(&p) {
            return parse_queries(&s);
        }
    }
    vec![]
}

fn parse_queries(json: &str) -> Vec<QueryDef> {
    let mut res = Vec::new();
    let qi = match json.find("\"QUERIES\"") { Some(i) => i, None => return res };
    let arr = match json[qi..].find('[') { Some(i) => qi + i, None => return res };
    let bytes = json.as_bytes();
    let mut i = arr + 1;
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i] as char).is_whitespace() || (i < bytes.len() && bytes[i] == b',') { if i < bytes.len() && (bytes[i] == b',' || (bytes[i] as char).is_whitespace()) { i += 1; } else { break; } }
        // simpler skip
        while i < bytes.len() && ((bytes[i] as char).is_whitespace() || bytes[i] == b',') { i += 1; }
        if i >= bytes.len() || bytes[i] == b']' { break; }
        if bytes[i] != b'{' { i += 1; continue; }
        let start = i;
        let mut depth = 0i32;
        let mut inq = false;
        let mut escp = false;
        while i < bytes.len() {
            let c = bytes[i] as char;
            if inq {
                if escp { escp = false; }
                else if c == '\\' { escp = true; }
                else if c == '"' { inq = false; }
            } else {
                if c == '"' { inq = true; }
                else if c == '{' { depth += 1; }
                else if c == '}' { depth -= 1; if depth == 0 { i += 1; break; } }
            }
            i += 1;
        }
        let obj = &json[start..i.min(json.len())];
        let q = QueryDef {
            id: jstr(obj, "id").unwrap_or_default(),
            label: jstr(obj, "label").unwrap_or_default(),
            category: jstr(obj, "category").unwrap_or_default(),
            module: jstr(obj, "module").unwrap_or_default(),
            priority: jstr(obj, "priority").unwrap_or_else(|| "informational".into()),
            template: jstr(obj, "template").unwrap_or_default(),
            description: jstr(obj, "description").unwrap_or_default(),
            explanation: jstr(obj, "explanation").unwrap_or_default(),
            engines_note: jstr(obj, "enginesNote").unwrap_or_else(|| "Varies by engine.".into()),
            global: jbool(obj, "global").unwrap_or(false),
            operators: jarr_str(obj, "operators"),
        };
        if !q.template.is_empty() { res.push(q); }
    }
    res
}

fn jstr(src: &str, key: &str) -> Option<String> {
    let pat = format!("\"{}\"", key);
    let p = src.find(&pat)? + pat.len();
    let p = src[p..].find(':')? + p + 1;
    let rest = &src[p..];
    let p = rest.find('"')? + 1;
    let bytes = rest.as_bytes();
    let mut i = p;
    let mut out = String::new();
    let mut escp = false;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if escp {
            out.push(match c { 'n'=>'\n','r'=>'\r','t'=>'\t', other=>other });
            escp = false;
        } else if c == '\\' { escp = true; }
        else if c == '"' { return Some(out); }
        else { out.push(c); }
        i += 1;
    }
    None
}
fn jbool(src: &str, key: &str) -> Option<bool> {
    let pat = format!("\"{}\"", key);
    let p = src.find(&pat)? + pat.len();
    let p = src[p..].find(':')? + p + 1;
    let rest = src[p..].trim_start();
    if rest.starts_with("true") { Some(true) } else if rest.starts_with("false") { Some(false) } else { None }
}
fn jarr_str(src: &str, key: &str) -> Vec<String> {
    let pat = format!("\"{}\"", key);
    let p = match src.find(&pat) { Some(x)=>x+pat.len(), None=>return vec![] };
    let p = match src[p..].find('[') { Some(x)=>p+x, None=>return vec![] };
    let bytes = src.as_bytes();
    let mut i = p+1; let mut depth=0i32; let mut inq=false; let mut escp=false;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if inq { if escp { escp=false; } else if c=='\\' { escp=true; } else if c=='"' { inq=false; } }
        else { if c=='"' { inq=true; } else if c=='[' { depth+=1; } else if c==']' { if depth==0 { break; } depth-=1; } }
        i += 1;
    }
    if i >= bytes.len() { return vec![]; }
    let arr = &src[p+1..i];
    let mut res = Vec::new();
    let ab = arr.as_bytes();
    let mut j=0;
    while j < ab.len() {
        while j < ab.len() && ((ab[j] as char).is_whitespace() || ab[j]==b',') { j+=1; }
        if j>=ab.len() || ab[j]!=b'"' { break; }
        j+=1; let mut out=String::new(); let mut es=false;
        while j < ab.len() {
            let c = ab[j] as char;
            if es { out.push(match c {'n'=>'\n','r'=>'\r','t'=>'\t',o=>o}); es=false; }
            else if c=='\\' { es=true; }
            else if c=='"' { j+=1; break; }
            else { out.push(c); }
            j+=1;
        }
        res.push(out);
    }
    res
}

fn normalize_ws(s: &str) -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") }
fn validate_q(q: &str) -> bool {
    if q.trim().is_empty() { return false; }
    for ph in ["{target}","{keyword}","{extension}","{subdomain}","{path}","{date_from}","{date_to}"] { if q.contains(ph) { return false; } }
    if q.matches('"').count() % 2 != 0 { return false; }
    let mut d=0i32; for c in q.chars() { if c=='(' {d+=1;} else if c==')' {d-=1; if d<0 {return false;} } }
    d==0
}
fn rank(p:&str)->i32{ match p { "critical"=>5,"high"=>4,"medium"=>3,"low"=>2,_=>1 } }
fn detect_ops(q:&str)->Vec<String>{ let mut o=Vec::new(); let checks=[("site:","site:"),("inurl:","inurl:"),("intitle:","intitle:"),("intext:","intext:"),("filetype:","filetype:"),("ext:","ext:"),("cache:","cache:")]; for (n,needle) in checks { if q.to_lowercase().contains(needle) { o.push(n.to_string()); } } if q.contains('"') { o.push("\"".to_string()); } if q.contains(" OR ") || q.contains('|') { o.push("OR".to_string()); } if q.contains('(')||q.contains(')') { o.push("()".to_string()); } o }

fn to_root(h:&str)->String{ let h=h.trim_start_matches("*."); let parts:Vec<&str>=h.split('.').collect(); if parts.len()<=2 { return h.to_string(); } let last2=format!("{}.{}", parts[parts.len()-2], parts[parts.len()-1]); let multi=["co.uk","org.uk","ac.uk","gov.uk","com.au","net.au","org.au","co.jp","co.nz","com.br","com.mx","co.in"]; if multi.contains(&last2.as_str()) && parts.len()>=3 { return format!("{}.{}", parts[parts.len()-3], last2); } last2 }

fn normalize_target(raw:&str, scope_in:&str)->(bool,String,String,String){
    let inp = raw.trim().to_string();
    if inp.is_empty() { return (false,String::new(),String::new(),"Target is required.".to_string()); }
    if inp.to_lowercase().starts_with("javascript:") { return (false,String::new(),String::new(),"Unsafe URL scheme is not allowed.".to_string()); }
    let mut s = inp.clone();
    if let Some(i)=s.find("://") { let pre=&s[..i]; if pre.chars().all(|c| c.is_ascii_alphanumeric()||c=='+'||c=='.'||c=='-') { s = s[i+3..].to_string(); } }
    if let Some(at)=s.find('@') { let sl=s.find('/').unwrap_or(usize::MAX); if at<sl { s=s[at+1..].to_string(); } }
    let cut = s.find(|c| c=='/'||c=='?'||c=='#'||c==':').unwrap_or(s.len());
    s = s[..cut].trim().to_lowercase();
    if s.contains("..") || s.is_empty() { return (false,String::new(),String::new(),"Invalid domain/hostname format.".to_string()); }
    let mut scope = scope_in.to_string(); if scope.is_empty() { scope="root".to_string(); }
    let (target,label) = match scope.as_str() {
        "root" => (to_root(&s), "Root domain".to_string()),
        "root_sub" => (to_root(&s), "Root domain and subdomains".to_string()),
        "exact" => (s.trim_start_matches("*.").to_string(), "Exact hostname".to_string()),
        "custom" => (s.clone(), "Custom scope".to_string()),
        _ => (to_root(&s), "Root domain".to_string()),
    };
    (true, target, label, String::new())
}

fn esc(s:&str)->String{
    let mut o=String::with_capacity(s.len()+8);
    for c in s.chars() { match c { '"' => o.push_str("\\\""), '\\'=>o.push_str("\\\\"), '\n'=>o.push_str("\\n"), '\r'=>o.push_str("\\r"), '\t'=>o.push_str("\\t"), c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)), c=>o.push(c) } }
    o
}
fn str_arr(a:&[String])->String{ let inner=a.iter().map(|s| format!("\"{}\"", esc(s))).collect::<Vec<_>>().join(","); format!("[{}]", inner) }
