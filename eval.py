from multi_agent import run_pipeline
import json
import time

test_topics = [
    "impact of remote work on urban real estate prices",
    "adoption of electric buses in Indian public transport",
    "effectiveness of intermittent fasting for weight loss",
    "rise of decentralized finance platforms",
    "water scarcity solutions in drought-prone regions",
]

def evaluate_run(topic, final_report, verification_note, trace):
    research_steps = [t for t in trace if t["step"] == "research"]
    all_found_content = all(t["content_found"] for t in research_steps)

    verification_ok = "unsupported" not in verification_note.lower() and "fabricat" not in verification_note.lower() and "contradict" not in verification_note.lower()

    synthesis_step = next((t for t in trace if t["step"] == "synthesis"), None)
    covered_all_subquestions = synthesis_step and synthesis_step["sub_questions_used"] == len(research_steps)

    passed = all_found_content and verification_ok and covered_all_subquestions

    return {
        "topic": topic,
        "passed": passed,
        "all_sources_found_content": all_found_content,
        "verification_clean": verification_ok,
        "all_subquestions_covered": covered_all_subquestions,
    }

results = []

for topic in test_topics:
    print(f"\n{'='*60}")
    print(f"Testing: {topic}")
    print('='*60)
    try:
        final_report, verification_note, trace = run_pipeline(topic)
        result = evaluate_run(topic, final_report, verification_note, trace)
    except Exception as e:
        result = {"topic": topic, "passed": False, "error": str(e)}
    results.append(result)
    time.sleep(15)

passed_count = sum(1 for r in results if r["passed"])
print(f"\n\n{'='*60}")
print(f"EVALUATION COMPLETE: {passed_count}/{len(results)} passed")
print('='*60)

with open("eval_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)

print("Full results saved to eval_results.json")