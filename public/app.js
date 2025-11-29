const findBtn = document.getElementById("findBtn");

findBtn.addEventListener("click", () => {
  findBtn.innerText = "Finding Partner...";
  findBtn.disabled = true;
  setTimeout(() => {
    findBtn.innerText = "Find Partner";
    findBtn.disabled = false;
  }, 4000);
});
