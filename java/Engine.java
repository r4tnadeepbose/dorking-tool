import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

/**
 * Dorking Tool query engine (Java).
 * Reads JSON input from stdin: {"target":"example.com","scope":"root","modules":["domain",...]}
 * Loads query definitions from ../data.json or ./data.json.
 * Outputs JSON result to stdout.
 *
 * Compile: javac --release 8 Engine.java
 * Run:     java Engine < input.json
 */
public class Engine {
    static class QueryDef {
        String id="", label="", category="", module="", priority="", template="", description="", explanation="", enginesNote="";
        boolean global=false;
        List<String> operators = new ArrayList<String>();
    }
    static class OutQ {
        String id,key,label,category,module,priority,query,description,explanation,enginesNote,source="preset",status="Not Reviewed",notes="";
        boolean global,saved=false,selected=true;
        List<String> operators=new ArrayList<String>(); List<String> tags=new ArrayList<String>();
        int rank=1;
    }

    public static void main(String[] args) throws Exception {
        String input = readAll(System.in);
        String target = jstr(input, "target", "example.com");
        String scope = jstr(input, "scope", "root");
        List<String> modules = jarrStr(input, "modules");
        Map<String,Object> norm = normalizeTarget(target, scope);
        if (!Boolean.TRUE.equals(norm.get("ok"))) {
            System.out.print("{\"ok\":false,\"error\":\"" + esc(String.valueOf(norm.get("error"))) + "\"}");
            return;
        }
        String normTarget = String.valueOf(norm.get("normalized"));
        List<QueryDef> defs = loadQueries();
        if (defs.isEmpty()) {
            System.out.print("{\"ok\":false,\"error\":\"data.json not found or no queries loaded\"}");
            return;
        }
        Set<String> modset = new HashSet<String>(modules);
        Map<String, OutQ> seen = new LinkedHashMap<String, OutQ>();
        for (QueryDef d : defs) {
            if (!modset.isEmpty() && !modset.contains(d.module)) continue;
            String qs = d.template.replace("{target}", normTarget);
            if (!d.global && "root_sub".equals(scope) && "site:{target}".equals(normalizeWs(d.template))) {
                qs = "(site:" + normTarget + " OR site:*." + normTarget + ")";
            }
            qs = normalizeWs(qs);
            if (!validateQ(qs)) continue;
            String key = qs.toLowerCase(Locale.ROOT);
            OutQ o = new OutQ();
            o.id = d.id + "_java"; o.key = key; o.label = d.label; o.category = d.category; o.module = d.module;
            o.priority = d.priority.isEmpty()?"informational":d.priority; o.query = qs; o.description = d.description; o.explanation = d.explanation;
            o.enginesNote = d.enginesNote.isEmpty()?"Varies by engine.":d.enginesNote; o.global = d.global; o.operators = d.operators.isEmpty()?detectOps(qs):d.operators;
            o.rank = rank(o.priority);
            OutQ prev = seen.get(key);
            if (prev == null || o.rank > prev.rank) seen.put(key, o);
        }
        List<OutQ> out = new ArrayList<OutQ>(seen.values());
        Collections.sort(out, new Comparator<OutQ>(){ public int compare(OutQ a, OutQ b){ int c=a.category.compareTo(b.category); return c!=0?c:a.label.compareTo(b.label);} });
        StringBuilder sb = new StringBuilder();
        sb.append("{\"ok\":true,\"engine_used\":\"java\",\"target\":{\"ok\":true,\"normalized\":\"").append(esc(normTarget))
          .append("\",\"scope\":\"").append(esc(scope)).append("\",\"scopeLabel\":\"").append(esc(String.valueOf(norm.get("scopeLabel")))).append("\"},\"count\":")
          .append(out.size()).append(",\"queries\":[");
        for (int i=0;i<out.size();i++){ if(i>0) sb.append(','); appendOut(sb,out.get(i)); }
        sb.append("]}");
        System.out.print(sb.toString());
    }

    static void appendOut(StringBuilder sb, OutQ o){
        sb.append('{')
          .append("\"id\":\"").append(esc(o.id)).append("\",")
          .append("\"key\":\"").append(esc(o.key)).append("\",")
          .append("\"label\":\"").append(esc(o.label)).append("\",")
          .append("\"category\":\"").append(esc(o.category)).append("\",")
          .append("\"module\":\"").append(esc(o.module)).append("\",")
          .append("\"priority\":\"").append(esc(o.priority)).append("\",")
          .append("\"query\":\"").append(esc(o.query)).append("\",")
          .append("\"description\":\"").append(esc(o.description)).append("\",")
          .append("\"explanation\":\"").append(esc(o.explanation)).append("\",")
          .append("\"operators\":").append(strArr(o.operators)).append(',')
          .append("\"enginesNote\":\"").append(esc(o.enginesNote)).append("\",")
          .append("\"global\":").append(o.global).append(',')
          .append("\"source\":\"preset\",\"status\":\"Not Reviewed\",\"saved\":false,\"selected\":true,\"notes\":\"\",\"tags\":[]}");
    }

    static String strArr(List<String> a){ StringBuilder sb=new StringBuilder("["); for(int i=0;i<a.size();i++){ if(i>0) sb.append(','); sb.append('"').append(esc(a.get(i))).append('"'); } return sb.append(']').toString(); }

    static List<QueryDef> loadQueries() throws Exception {
        String[] paths = {"data.json", "..\\data.json", "../data.json"};
        for (String p : paths) {
            Path path = Paths.get(p);
            if (Files.exists(path)) {
                String json = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
                return parseQueries(json);
            }
        }
        return Collections.emptyList();
    }

    // Minimal parser for data.json QUERIES array (objects produced by our known structure)
    static List<QueryDef> parseQueries(String json) {
        List<QueryDef> res = new ArrayList<QueryDef>();
        int qi = json.indexOf("\"QUERIES\"");
        if (qi < 0) return res;
        int arr = json.indexOf('[', qi); if (arr < 0) return res;
        int i = arr + 1;
        while (i < json.length()) {
            while (i < json.length() && (Character.isWhitespace(json.charAt(i)) || json.charAt(i)==',')) i++;
            if (i >= json.length() || json.charAt(i)==']') break;
            if (json.charAt(i)!='{') { i++; continue; }
            int start = i, depth=0; boolean inq=false, esc=false;
            for (; i < json.length(); i++) {
                char c=json.charAt(i);
                if (inq){ if(esc) esc=false; else if(c=='\\') esc=true; else if(c=='"') inq=false; }
                else { if(c=='"') inq=true; else if(c=='{') depth++; else if(c=='}'){ depth--; if(depth==0){ i++; break; } } }
            }
            String obj = json.substring(start, i);
            QueryDef q = new QueryDef();
            q.id = jstr(obj, "id", ""); q.label = jstr(obj, "label", ""); q.category = jstr(obj, "category", "");
            q.module = jstr(obj, "module", ""); q.priority = jstr(obj, "priority", "informational");
            q.template = jstr(obj, "template", ""); q.description = jstr(obj, "description", "");
            q.explanation = jstr(obj, "explanation", ""); q.enginesNote = jstr(obj, "enginesNote", "Varies by engine.");
            q.global = jbool(obj, "global", false); q.operators = jarrStr(obj, "operators");
            if (!q.template.isEmpty()) res.add(q);
        }
        return res;
    }

    static String jstr(String src, String key, String def) {
        String pat = "\"" + key + "\""; int p = src.indexOf(pat); if (p<0) return def;
        p = src.indexOf(':', p + pat.length()); if (p<0) return def; p++;
        while (p<src.length() && Character.isWhitespace(src.charAt(p))) p++;
        if (p>=src.length() || src.charAt(p)!='"') return def; p++;
        StringBuilder v=new StringBuilder(); boolean esc=false;
        for (; p<src.length(); p++) { char c=src.charAt(p); if(esc){ if(c=='n')v.append('\n'); else if(c=='r')v.append('\r'); else if(c=='t')v.append('\t'); else v.append(c); esc=false; } else if(c=='\\'){ esc=true; } else if(c=='"'){ return v.toString(); } else v.append(c); }
        return def;
    }
    static boolean jbool(String src, String key, boolean def){
        String pat = "\"" + key + "\""; int p = src.indexOf(pat); if (p<0) return def;
        p = src.indexOf(':', p + pat.length()); if (p<0) return def; p++;
        while (p<src.length() && Character.isWhitespace(src.charAt(p))) p++;
        if (src.startsWith("true", p)) return true; if (src.startsWith("false", p)) return false; return def;
    }
    static List<String> jarrStr(String src, String key){
        List<String> res=new ArrayList<String>(); String pat="\""+key+"\""; int p=src.indexOf(pat); if(p<0) return res;
        p=src.indexOf('[',p); if(p<0) return res; int e=p+1, depth=0; boolean inq=false, esc=false;
        for(;e<src.length();e++){ char c=src.charAt(e); if(inq){ if(esc) esc=false; else if(c=='\\') esc=true; else if(c=='"') inq=false; } else { if(c=='"') inq=true; else if(c=='[') depth++; else if(c==']'){ if(depth==0) break; depth--; } } }
        if(e>=src.length()) return res; String arr=src.substring(p+1,e); int i=0;
        while(i<arr.length()){ while(i<arr.length() && (Character.isWhitespace(arr.charAt(i))||arr.charAt(i)==',')) i++; if(i>=arr.length()||arr.charAt(i)!='"') break; i++; StringBuilder v=new StringBuilder(); boolean es=false; for(;i<arr.length();i++){ char c=arr.charAt(i); if(es){ if(c=='n')v.append('\n'); else if(c=='r')v.append('\r'); else if(c=='t')v.append('\t'); else v.append(c); es=false; } else if(c=='\\'){ es=true; } else if(c=='"'){ i++; break; } else v.append(c); } res.add(v.toString()); }
        return res;
    }

    static String readAll(InputStream in) throws IOException { ByteArrayOutputStream bos=new ByteArrayOutputStream(); byte[] buf=new byte[4096]; int n; while((n=in.read(buf))>=0) bos.write(buf,0,n); return new String(bos.toByteArray(), StandardCharsets.UTF_8); }
    static String normalizeWs(String s){ return s==null?"":s.replaceAll("\\s+"," ").trim(); }
    static boolean validateQ(String q){ if(q.isEmpty()) return false; if(q.matches(".*\\{(target|keyword|extension|subdomain|path|date_from|date_to)\\}.*")) return false; int quotes=0,depth=0; for(int i=0;i<q.length();i++){ char c=q.charAt(i); if(c=='"') quotes++; if(c=='(') depth++; if(c==')'){ depth--; if(depth<0) return false; } } return quotes%2==0 && depth==0; }
    static int rank(String p){ if("critical".equals(p)) return 5; if("high".equals(p)) return 4; if("medium".equals(p)) return 3; if("low".equals(p)) return 2; return 1; }
    static List<String> detectOps(String q){ List<String> ops=new ArrayList<String>(); String[][] checks={{"site:","(?i)\\bsite:"},{"inurl:","(?i)\\binurl:"},{"intitle:","(?i)\\bintitle:"},{"intext:","(?i)\\bintext:"},{"filetype:","(?i)\\bfiletype:"},{"ext:","(?i)\\bext:"},{"cache:","(?i)\\bcache:"},{"OR","\\bOR\\b|\\|"},{"\"","\"[^\"]+\""},{"-","(?:^|\\s)-\\S"},{"()","[()]"}}; for(String[] c:checks){ if(Pattern.compile(c[1]).matcher(q).find()) ops.add(c[0]); } return ops; }
    static String esc(String s){ if(s==null) return ""; StringBuilder sb=new StringBuilder(s.length()+8); for(int i=0;i<s.length();i++){ char c=s.charAt(i); switch(c){ case '"': sb.append("\\\""); break; case '\\': sb.append("\\\\"); break; case '\n': sb.append("\\n"); break; case '\r': sb.append("\\r"); break; case '\t': sb.append("\\t"); break; default: if(c<0x20) sb.append(String.format("\\u%04x",(int)c)); else sb.append(c);} } return sb.toString(); }

    static Map<String,Object> normalizeTarget(String raw, String scope){
        Map<String,Object> r=new LinkedHashMap<String,Object>();
        String inp = raw==null?"":raw.trim();
        if(inp.isEmpty()){ r.put("ok",false); r.put("error","Target is required."); return r; }
        if(inp.toLowerCase(Locale.ROOT).matches("^\\s*javascript:.*")){ r.put("ok",false); r.put("error","Unsafe URL scheme is not allowed."); return r; }
        String s = inp.replaceFirst("^[a-zA-Z][a-zA-Z0-9+.-]*://","").replaceFirst("^[^@/]+@","");
        int cut = -1; for(char c: new char[]{'/','?','#',':'}){ int idx=s.indexOf(c); if(idx>=0 && (cut<0||idx<cut)) cut=idx; }
        if(cut>=0) s=s.substring(0,cut); s=s.trim().toLowerCase(Locale.ROOT);
        Pattern dre=Pattern.compile("^(?:\\*\\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$");
        if(s.contains("..") || !dre.matcher(s).matches()){ r.put("ok",false); r.put("error","Invalid domain/hostname format."); return r; }
        String target=s,label="Exact hostname";
        if("root".equals(scope)){ target=toRoot(s); label="Root domain"; }
        else if("root_sub".equals(scope)){ target=toRoot(s); label="Root domain and subdomains"; }
        else if("exact".equals(scope)){ if(target.startsWith("*.")) target=target.substring(2); label="Exact hostname"; }
        else if("custom".equals(scope)){ label="Custom scope"; } else { scope="root"; target=toRoot(s); label="Root domain"; }
        if(!dre.matcher(target).matches()){ r.put("ok",false); r.put("error","Normalized target is invalid."); return r; }
        r.put("ok",true); r.put("normalized",target); r.put("scope",scope); r.put("scopeLabel",label); r.put("input",inp);
        r.put("display", "root_sub".equals(scope)?target+" (+ subdomains)":target);
        return r;
    }
    static String toRoot(String h){ if(h.startsWith("*.")) h=h.substring(2); String[] parts=h.split("\\."); if(parts.length<=2) return h; String last2=parts[parts.length-2]+"."+parts[parts.length-1]; Set<String> multi=new HashSet<String>(Arrays.asList("co.uk","org.uk","ac.uk","gov.uk","com.au","net.au","org.au","co.jp","co.nz","com.br","com.mx","co.in")); if(multi.contains(last2) && parts.length>=3) return parts[parts.length-3]+"."+last2; return last2; }
}
