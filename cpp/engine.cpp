// Minimal C++ query engine for Dorking Tool
// Reads JSON payload from stdin and writes JSON result to stdout.
// Payload: {"target":"example.com","scope":"root","modules":["domain",...],"queries":[{"id","module","template","global","label","category","priority","description","explanation","operators","enginesNote"}]}
// If "queries"/module data not provided, caller should use Python fallback; this binary focuses on normalize+generate+dedupe logic.
// Build (Windows, MSVC): cl /EHsc /O2 /std:c++17 engine.cpp /Fe:engine.exe
// Build (g++/clang++): c++ -O2 -std=c++17 engine.cpp -o engine

#include <algorithm>
#include <cctype>
#include <iostream>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace std;

static string trim(const string& s){ size_t a=0,b=s.size(); while(a<b && isspace((unsigned char)s[a])) a++; while(b>a && isspace((unsigned char)s[b-1])) b--; return s.substr(a,b-a); }
static string lower(string s){ for(char& c:s) c=(char)tolower((unsigned char)c); return s; }
static string normalize_ws(string s){ string out; bool sp=false; for(char c:s){ if(isspace((unsigned char)c)){ if(!sp){ out.push_back(' '); sp=true; } } else { out.push_back(c); sp=false; } } return trim(out); }
static string json_escape(const string& s){ string o; o.reserve(s.size()+8); for(char c:s){ switch(c){ case '"': o+="\\\""; break; case '\\': o+="\\\\"; break; case '\n': o+="\\n"; break; case '\r': o+="\\r"; break; case '\t': o+="\\t"; break; default: if((unsigned char)c<0x20){ char buf[7]; snprintf(buf,sizeof(buf),"\\u%04x",(unsigned char)c); o+=buf; } else o+=c; } } return o; }
static bool extract_string(const string& src, const string& key, string& out){
    string pat = "\"" + key + "\""; size_t p = src.find(pat); if(p==string::npos) return false; p = src.find(':', p+pat.size()); if(p==string::npos) return false; p++; while(p<src.size() && isspace((unsigned char)src[p])) p++; if(p>=src.size()||src[p]!='"') return false; p++; string v; bool esc=false; for(;p<src.size();++p){ char c=src[p]; if(esc){ if(c=='n')v+='\n'; else if(c=='r')v+='\r'; else if(c=='t')v+='\t'; else v+=c; esc=false; } else if(c=='\\'){ esc=true; } else if(c=='"'){ out=v; return true; } else v+=c; } return false;
}
static bool extract_bool(const string& src, const string& key, bool& out){
    string pat = "\"" + key + "\""; size_t p = src.find(pat); if(p==string::npos) return false; p = src.find(':', p+pat.size()); if(p==string::npos) return false; p++; while(p<src.size() && isspace((unsigned char)src[p])) p++; if(src.compare(p,4,"true")==0){out=true;return true;} if(src.compare(p,5,"false")==0){out=false;return true;} return false;
}
static vector<string> extract_string_array(const string& src, const string& key){
    vector<string> res; string pat = "\"" + key + "\""; size_t p = src.find(pat); if(p==string::npos) return res; p = src.find('[', p); if(p==string::npos) return res; size_t e = p+1; int depth=0; bool inq=false, esc=false; for(;e<src.size();++e){ char c=src[e]; if(inq){ if(esc) esc=false; else if(c=='\\') esc=true; else if(c=='"') inq=false; } else { if(c=='"') inq=true; else if(c=='[') depth++; else if(c==']'){ if(depth==0) break; depth--; } } }
    string arr = src.substr(p+1, e-(p+1)); size_t i=0; while(i<arr.size()){ while(i<arr.size() && isspace((unsigned char)arr[i])||arr[i]==',') i++; if(i>=arr.size()||arr[i]!='"') break; i++; string v; bool es=false; for(;i<arr.size();++i){ char c=arr[i]; if(es){ if(c=='n')v+='\n'; else if(c=='r')v+='\r'; else if(c=='t')v+='\t'; else v+=c; es=false; } else if(c=='\\'){ es=true; } else if(c=='"'){ i++; break; } else v+=c; } res.push_back(v); }
    return res;
}

struct QDef { string id,module,templateStr,label,category,priority,description,explanation,enginesNote; bool global=false; };

static vector<QDef> extract_queries(const string& src){
    vector<QDef> out; string key = "\"queries\""; size_t p = src.find(key); if(p==string::npos) return out; p = src.find('[', p); if(p==string::npos) return out; size_t i=p+1; while(i<src.size()){
        while(i<src.size() && (isspace((unsigned char)src[i])||src[i]==',')) i++; if(i>=src.size()||src[i]==']') break; if(src[i]!='{'){ i++; continue; }
        int depth=0; bool inq=false, esc=false; size_t start=i; for(;i<src.size();++i){ char c=src[i]; if(inq){ if(esc) esc=false; else if(c=='\\') esc=true; else if(c=='"') inq=false; } else { if(c=='"') inq=true; else if(c=='{') depth++; else if(c=='}'){ depth--; if(depth==0){ i++; break; } } } }
        string obj = src.substr(start, i-start);
        QDef q; extract_string(obj,"id",q.id); extract_string(obj,"module",q.module); extract_string(obj,"template",q.templateStr); extract_string(obj,"label",q.label); extract_string(obj,"category",q.category); extract_string(obj,"priority",q.priority); extract_string(obj,"description",q.description); extract_string(obj,"explanation",q.explanation); extract_string(obj,"enginesNote",q.enginesNote); extract_bool(obj,"global",q.global);
        if(!q.templateStr.empty() || !q.module.empty()) out.push_back(q);
    }
    return out;
}

static string to_root(string h){ if(h.rfind("*.",0)==0) h=h.substr(2); vector<string> parts; string cur; for(char c:h){ if(c=='.'){ if(!cur.empty()){parts.push_back(cur); cur.clear();} } else cur+=c; } if(!cur.empty()) parts.push_back(cur); if(parts.size()<=2) return h; auto join=[&](size_t n){ string r; for(size_t i=parts.size()-n;i<parts.size();++i){ if(!r.empty()) r+='.'; r+=parts[i]; } return r; }; set<string> multi={"co.uk","org.uk","ac.uk","gov.uk","com.au","net.au","org.au","co.jp","co.nz","com.br","com.mx","co.in"}; if(parts.size()>=3 && multi.count(join(2))) return join(3); return join(2); }

static pair<bool,string> normalize_target(string raw, string scope, string& outNorm, string& outScopeLabel){
    string inp = trim(raw); if(inp.empty()) return {false,"Target is required."};
    string low = lower(inp); if(low.rfind("javascript:",0)==0) return {false,"Unsafe URL scheme is not allowed."};
    string s = inp;
    { regex re("^[a-zA-Z][a-zA-Z0-9+.-]*://"); s = regex_replace(s,re,""); }
    { size_t at=s.find('@'), sl=s.find('/'); if(at!=string::npos && (sl==string::npos||at<sl)) s=s.substr(at+1); }
    for(char& c:s) c=(char)tolower((unsigned char)c);
    size_t cut=s.find_first_of("/?#:"); if(cut!=string::npos) s=s.substr(0,cut); s=trim(s);
    if(s.find("..")!=string::npos) return {false,"Invalid domain/hostname format."};
    regex dre("^(?:\\*\\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$");
    if(!regex_match(s,dre)) return {false,"Invalid domain/hostname format."};
    string target=s, label="Exact hostname";
    if(scope=="root"){ target=to_root(s); label="Root domain"; }
    else if(scope=="root_sub"){ target=to_root(s); label="Root domain and subdomains"; }
    else if(scope=="exact"){ if(target.rfind("*.",0)==0) target=target.substr(2); label="Exact hostname"; }
    else if(scope=="custom"){ label="Custom scope"; }
    if(!regex_match(target,dre)) return {false,"Normalized target is invalid."};
    outNorm=target; outScopeLabel=label; return {true,""};
}

static bool validate_q(const string& q){
    if(q.empty()) return false; if(q.find("{target}")!=string::npos) return false; int quotes=0, depth=0; for(char c:q){ if(c=='"') quotes++; if(c=='(') depth++; if(c==')') depth--; if(depth<0) return false; } return (quotes%2==0 && depth==0);
}

int main(){
    ios::sync_with_stdio(false);
    string input((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
    string target="example.com", scope="root"; extract_string(input,"target",target); extract_string(input,"scope",scope);
    vector<string> modules = extract_string_array(input,"modules");
    unordered_set<string> modset(modules.begin(), modules.end());
    vector<QDef> defs = extract_queries(input);
    string norm, scopeLabel; auto nr = normalize_target(target, scope, norm, scopeLabel);
    if(!nr.first){ cout << "{\"ok\":false,\"error\":\"" << json_escape(nr.second) << "\"}"; return 0; }
    if(defs.empty()){
        cout << "{\"ok\":false,\"error\":\"No query definitions provided to C++ engine; use Python fallback.\"}"; return 0;
    }
    struct Out{ string key,json; int rank; };
    unordered_map<string, Out> seen; auto rankp=[&](const string& p){ if(p=="critical")return 5; if(p=="high")return 4; if(p=="medium")return 3; if(p=="low")return 2; return 1; };
    for(auto& d: defs){ if(!modset.empty() && !modset.count(d.module)) continue; string qs=d.templateStr; size_t pos=0; while((pos=qs.find("{target}",pos))!=string::npos){ qs.replace(pos,8,norm); pos+=norm.size(); } if(!d.global && scope=="root_sub" && normalize_ws(d.templateStr)==string("site:{target}")) qs = "(site:"+norm+" OR site:*."+norm+")"; qs = normalize_ws(qs); if(!validate_q(qs)) continue; string key = lower(qs); int r=rankp(d.priority);
        ostringstream j; j << "{\"id\":\""<<json_escape(d.id.empty()?string("q"):d.id)<<"_"<< (std::hash<string>{}(qs)%100000) <<"\","
          << "\"key\":\""<<json_escape(key)<<"\",\"label\":\""<<json_escape(d.label)<<"\",\"category\":\""<<json_escape(d.category)<<"\","
          << "\"module\":\""<<json_escape(d.module)<<"\",\"priority\":\""<<json_escape(d.priority.empty()?"informational":d.priority)<<"\","
          << "\"query\":\""<<json_escape(qs)<<"\",\"description\":\""<<json_escape(d.description)<<"\",\"explanation\":\""<<json_escape(d.explanation)<<"\","
          << "\"enginesNote\":\""<<json_escape(d.enginesNote.empty()?"Varies by engine.":d.enginesNote)<<"\","
          << "\"global\":"<<(d.global?"true":"false")<<",\"source\":\"preset\",\"status\":\"Not Reviewed\",\"saved\":false,\"selected\":true,\"notes\":\"\",\"tags\":[]}";
        auto it=seen.find(key); if(it==seen.end() || r>it->second.rank) seen[key]={key,j.str(),r};
    }
    cout << "{\"ok\":true,\"engine_used\":\"cpp\",\"target\":{\"ok\":true,\"normalized\":\""<<json_escape(norm)<<"\",\"scope\":\""<<json_escape(scope)<<"\",\"scopeLabel\":\""<<json_escape(scopeLabel)<<"\"},\"count\":"<<seen.size()<<",\"queries\":[";
    bool first=true; for(auto& kv: seen){ if(!first) cout<<','; cout<<kv.second.json; first=false; }
    cout << "]}";
    return 0;
}
